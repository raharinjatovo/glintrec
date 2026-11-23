import { EventEmitter } from 'node:events';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMp4Args, convertToMp4, killAllFfmpeg } from '../src/main/ffmpeg';
import { LibraryStore } from '../src/main/library-store';
import { mediaIdFromUrl } from '../src/main/media-route';
import { trimRecording } from '../src/main/trim';
import { MAX_LIBRARY_ENTRIES, sanitizeLibrary, toLibraryItems } from '../src/shared/library';
import { formatTrimTime, parseTimeInput, trimmedFileName, validateTrim } from '../src/shared/trim';

const ID = (n: number) => n.toString(16).padStart(16, '0');
const good = (n: number, extra: Record<string, unknown> = {}) =>
  ({ id: ID(n), path: `C:\\Videos\\rec-${n}.mp4`, name: `rec-${n}.mp4`, size: 10, durationSec: 5, createdAt: n, ...extra });

describe('validateTrim', () => {
  it('accepts and clamps into the duration', () => {
    expect(validateTrim(1, 4)).toEqual({ ok: true, start: 1, end: 4 });
    expect(validateTrim(-5, 99, 10)).toEqual({ ok: true, start: 0, end: 10 });
    expect(validateTrim(2, 3, undefined)).toEqual({ ok: true, start: 2, end: 3 });
  });
  it.each([
    ['NaN start', NaN, 2], ['Infinity end', 0, Infinity], ['string', '1', 2], ['null', null, 2],
    ['start == end', 3, 3], ['start > end', 5, 1], ['too short', 1, 1.05], ['start beyond duration', 20, 30],
  ])('rejects %s', (_n, s, e) => {
    expect(validateTrim(s, e, 10).ok).toBe(false);
  });
  it('rejects a malformed duration but treats null/undefined as unknown', () => {
    for (const d of [0, -1, NaN, Infinity, '9', {}]) expect(validateTrim(0, 1, d).ok).toBe(false);
    expect(validateTrim(0, 1, null).ok).toBe(true);
  });
  it('caps absurd values', () => {
    const r = validateTrim(0, 1e12);
    expect(r.ok && r.end).toBe(24 * 3600);
  });
});

describe('trim time helpers', () => {
  it('parses times and rejects junk', () => {
    expect(parseTimeInput('12.5')).toBe(12.5);
    expect(parseTimeInput('1:05')).toBe(65);
    expect(parseTimeInput(' 1:02:03.5 ')).toBe(3723.5);
    for (const bad of ['', 'abc', '-1', '1:99:x', '1e3', '--ss', '1:2:3:4', '99999999']) expect(parseTimeInput(bad)).toBeNull();
  });
  it('formats and names', () => {
    expect(formatTrimTime(65.04)).toBe('1:05.0');
    expect(formatTrimTime(3723.5)).toBe('1:02:03.5');
    expect(formatTrimTime(NaN)).toBe('0:00.0');
    expect(trimmedFileName('clip.webm')).toBe('clip-trim.mp4');
    expect(trimmedFileName('a.b.mp4')).toBe('a.b-trim.mp4');
  });
  it('buildMp4Args adds trim options as separate args after -i, only when asked', () => {
    const a = buildMp4Args('in file.webm', 'o.mp4', { start: 1.5, end: 4 });
    const i = a.indexOf('-i');
    expect(a.slice(i, i + 6)).toEqual(['-i', 'in file.webm', '-ss', '1.500', '-t', '2.500']);
    expect(buildMp4Args('i', 'o')).not.toContain('-ss');
  });
});

describe('library sanitize', () => {
  it('keeps good entries newest first and tolerates garbage roots', () => {
    const out = sanitizeLibrary({ version: 1, entries: [good(1), good(3), good(2)] });
    expect(out.map((e) => e.createdAt)).toEqual([3, 2, 1]);
    for (const junk of [null, undefined, 5, 'x', {}, { entries: 'no' }]) expect(sanitizeLibrary(junk)).toEqual([]);
  });
  it('drops malformed, unsafe and duplicate entries', () => {
    const out = sanitizeLibrary([
      null, 7, 'x', [],
      good(1, { id: 'zz' }), good(2, { id: 5 }),
      good(3, { path: 'relative\\a.mp4' }), good(4, { path: 'C:\\Windows\\evil.exe' }), good(5, { path: 'C:\\a\0.mp4' }),
      good(6, { path: 'C:\\' + 'x'.repeat(2000) + '.mp4' }), good(7, { path: 42 }),
      good(8), good(8), good(9, { id: ID(8) }), good(10, { path: 'c:\\videos\\REC-8.MP4' }),
    ]);
    expect(out.map((e) => e.id)).toEqual([ID(8)]);
  });
  it('repairs bad field values instead of trusting them', () => {
    const [e] = sanitizeLibrary([good(1, { name: '..\\evil', size: -4, durationSec: NaN, createdAt: 'x' })]);
    expect(e).toMatchObject({ name: 'rec-1.mp4', size: 0, durationSec: null, createdAt: 0 });
  });
  it('caps the length keeping the newest', () => {
    const many = Array.from({ length: MAX_LIBRARY_ENTRIES + 50 }, (_, i) => good(i + 1));
    const out = sanitizeLibrary(many);
    expect(out).toHaveLength(MAX_LIBRARY_ENTRIES);
    expect(out[0].createdAt).toBe(MAX_LIBRARY_ENTRIES + 50);
  });
  it('flags missing files and never exposes paths', () => {
    const entries = sanitizeLibrary([good(1), good(2)]);
    const items = toLibraryItems(entries, new Map([[ID(2), 99]]));
    expect(items.find((i) => i.id === ID(1))?.missing).toBe(true);
    expect(items.find((i) => i.id === ID(2))).toMatchObject({ missing: false, size: 99 });
    expect(JSON.stringify(items)).not.toContain('C:\\');
  });
});

describe('LibraryStore', () => {
  function memFs(files: Record<string, string> = {}) {
    const log: string[] = [];
    return {
      files, log,
      fs: {
        readFile: async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
        writeFile: async (p: string, d: string) => { log.push('write:' + p); files[p] = d; },
        rename: async (a: string, b: string) => { log.push('rename:' + a + '>' + b); files[b] = files[a]; delete files[a]; },
        mkdir: async () => undefined,
      },
    };
  }
  const stat = async (p: string) => {
    if (p.includes('gone')) throw new Error('ENOENT');
    return { size: 123, isFile: () => true };
  };

  it('loads empty on missing or corrupt index', async () => {
    for (const files of [{} as Record<string, string>, { '/l.json': '{bad' }, { '/l.json': '[1,2]' }]) {
      const s = new LibraryStore('/l.json', memFs(files).fs, stat as never);
      await s.load();
      expect(await s.list()).toEqual([]);
    }
  });
  it('adds atomically, refreshes by path, rejects non-media paths and survives reload', async () => {
    const m = memFs();
    let t = 100;
    const s = new LibraryStore('/l.json', m.fs, stat as never, () => t++);
    const a = await s.add('C:\\v\\a.mp4', 5, null);
    const again = await s.add('c:\\v\\A.mp4', 6, 2);
    expect(again.id).toBe(a.id);
    await expect(s.add('C:\\v\\evil.exe', 1, null)).rejects.toThrow();
    await expect(s.add('rel.mp4', 1, null)).rejects.toThrow();
    expect(m.log.slice(0, 2)).toEqual(['write:/l.json.tmp', 'rename:/l.json.tmp>/l.json']);
    const s2 = new LibraryStore('/l.json', m.fs, stat as never);
    await s2.load();
    expect((await s2.list()).map((i) => i.id)).toEqual([a.id]);
  });
  it('flags a vanished file and removes by id', async () => {
    const s = new LibraryStore('/l.json', memFs().fs, stat as never);
    const a = await s.add('C:\\v\\gone.mp4', 5, null);
    expect((await s.list())[0]).toMatchObject({ id: a.id, missing: true });
    expect(await s.remove('0'.repeat(16))).toBe(false);
    expect(await s.remove(a.id)).toBe(true);
    expect(s.get(a.id)).toBeUndefined();
  });
});

describe('mediaIdFromUrl', () => {
  it('accepts only app://media/<id>', () => {
    expect(mediaIdFromUrl(new URL(`app://media/${ID(1)}`))).toBe(ID(1));
    for (const u of [`app://local/${ID(1)}`, 'app://media/', 'app://media/x', `app://media/${ID(1)}/y`, 'app://media/..%2f..%2fetc', `app://media/${ID(1)}x`]) {
      expect(mediaIdFromUrl(new URL(u))).toBeNull();
    }
  });
});

describe('trimRecording', () => {
  let dir: string;
  beforeEach(async () => { dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'trim test ')); });
  afterEach(async () => { await fsp.rm(dir, { recursive: true, force: true }); });

  it('writes next to the source without overwriting and leaves no partial file', async () => {
    const input = path.join(dir, 'clip.webm');
    await fsp.writeFile(input, 'src');
    await fsp.writeFile(path.join(dir, 'clip-trim.mp4'), 'precious');
    const run = vi.fn(async (_i: string, out: string) => { await fsp.writeFile(out, 'new'); });
    const out = await trimRecording(input, 1, 2, run);
    expect(path.basename(out)).toBe('clip-trim (1).mp4');
    expect(await fsp.readFile(path.join(dir, 'clip-trim.mp4'), 'utf8')).toBe('precious');
    expect(await fsp.readFile(out, 'utf8')).toBe('new');
    expect(run).toHaveBeenCalledWith(input, expect.stringContaining('.partial-'), 1, 2);
    expect((await fsp.readdir(dir)).sort()).toEqual(['clip-trim (1).mp4', 'clip-trim.mp4', 'clip.webm']);
  });
  it('removes the partial file when ffmpeg fails', async () => {
    const input = path.join(dir, 'clip.mp4');
    await fsp.writeFile(input, 'src');
    const run = async (_i: string, out: string) => { await fsp.writeFile(out, 'half'); throw new Error('boom'); };
    await expect(trimRecording(input, 0, 1, run)).rejects.toThrow('boom');
    expect(await fsp.readdir(dir)).toEqual(['clip.mp4']);
  });
});

describe('ffmpeg timeout and kill', () => {
  function hangingSpawn(closeOnKill: boolean) {
    const kill = vi.fn();
    const spawnFn = (() => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
      child.stderr = new EventEmitter();
      child.kill = () => { kill(); if (closeOnKill) setTimeout(() => child.emit('close', null), 0); };
      return child;
    }) as never;
    return { spawnFn, kill };
  }

  it('kills on timeout, rejects, and deletes the partial output', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ff timeout '));
    const out = path.join(dir, 'o.mp4');
    await fsp.writeFile(out, 'half');
    const { spawnFn, kill } = hangingSpawn(true);
    await expect(convertToMp4('in', out, spawnFn, 'ffmpeg', 20)).rejects.toThrow('timed out');
    expect(kill).toHaveBeenCalledTimes(1);
    await expect(fsp.stat(out)).rejects.toThrow();
    await fsp.rm(dir, { recursive: true, force: true });
  });
  it('killAllFfmpeg stops live runs and rejects them', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ff kill '));
    const out = path.join(dir, 'o.mp4');
    await fsp.writeFile(out, 'half');
    const { spawnFn, kill } = hangingSpawn(true);
    const p = convertToMp4('in', out, spawnFn);
    const rejected = expect(p).rejects.toThrow('cancelled');
    await killAllFfmpeg();
    await rejected;
    expect(kill).toHaveBeenCalled();
    await expect(fsp.stat(out)).rejects.toThrow();
    await killAllFfmpeg(); // nothing live: resolves
    await fsp.rm(dir, { recursive: true, force: true });
  });
  it('does not hang when a killed process never reports close', async () => {
    vi.useFakeTimers();
    const { spawnFn } = hangingSpawn(false);
    const p = convertToMp4('in', path.join(os.tmpdir(), 'never-written.mp4'), spawnFn, 'ffmpeg', 10);
    const rejected = expect(p).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10 + 2500);
    await rejected;
    vi.useRealTimers();
  });
});
