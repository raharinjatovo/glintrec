import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { buildMp4Args, convertToMp4, detectFfmpeg, parseFfmpegVersion } from '../src/main/ffmpeg';
import { SettingsStore, type FsLike } from '../src/main/settings-store';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

function fakeSpawn(opts: { error?: boolean; code?: number; stdout?: string; stderr?: string }) {
  return ((..._a: unknown[]) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setTimeout(() => {
      if (opts.error) { child.emit('error', new Error('ENOENT')); return; }
      if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
      if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
      child.emit('close', opts.code ?? 0);
    }, 0);
    return child;
  }) as never;
}

describe('ffmpeg', () => {
  it('builds args with paths as single entries', () => {
    const a = buildMp4Args('C:\\Users\\WINDOWS 10\\in.webm', 'C:\\out dir\\o.mp4');
    expect(a).toContain('C:\\Users\\WINDOWS 10\\in.webm');
    expect(a[a.length - 1]).toBe('C:\\out dir\\o.mp4');
    expect(a.slice(0, 4)).toEqual(['-y', '-hide_banner', '-loglevel', 'error']);
  });
  it('parses version', () => {
    expect(parseFfmpegVersion('ffmpeg version 6.1.1-foo Copyright')).toBe('6.1.1-foo');
    expect(parseFfmpegVersion('nope')).toBeNull();
  });
  it('detects availability', async () => {
    expect(await detectFfmpeg(fakeSpawn({ error: true }))).toEqual({ available: false, version: null });
    expect(await detectFfmpeg(fakeSpawn({ stdout: 'ffmpeg version 7.0 x' }))).toEqual({ available: true, version: '7.0' });
    expect((await detectFfmpeg(fakeSpawn({ code: 1, stdout: 'ffmpeg version 7.0' }))).available).toBe(false);
  });
  it('convert rejects with stderr', async () => {
    await expect(convertToMp4('a', 'b', fakeSpawn({ code: 1, stderr: 'boom' }))).rejects.toThrow('boom');
    await expect(convertToMp4('a', 'b', fakeSpawn({ code: 0 }))).resolves.toBeUndefined();
  });
});

function memFs(files: Record<string, string> = {}) {
  const log: string[] = [];
  const fs: FsLike = {
    readFile: async (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
    writeFile: async (p, d) => { log.push('write:' + p); files[p] = d; },
    rename: async (a, b) => { log.push('rename:' + a + '>' + b); files[b] = files[a]; delete files[a]; },
    mkdir: async () => undefined,
  };
  return { fs, files, log };
}

describe('SettingsStore', () => {
  it('defaults when missing or corrupt', async () => {
    expect(await new SettingsStore('/s.json', memFs().fs).load()).toEqual(DEFAULT_SETTINGS);
    expect(await new SettingsStore('/s.json', memFs({ '/s.json': '{bad' }).fs).load()).toEqual(DEFAULT_SETTINGS);
  });
  it('saves atomically and clamps', async () => {
    const m = memFs();
    const store = new SettingsStore('/s.json', m.fs);
    const saved = await store.save({ ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay, sizePercent: 500 } });
    expect(saved.overlay.sizePercent).toBe(40);
    expect(m.log).toEqual(['write:/s.json.tmp', 'rename:/s.json.tmp>/s.json']);
    expect(JSON.parse(m.files['/s.json']).overlay.sizePercent).toBe(40);
    expect(store.get().overlay.sizePercent).toBe(40);
  });
});
