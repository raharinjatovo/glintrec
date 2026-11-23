import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...a: any[]) => Promise<any>>();
const dialogState: { result: any } = { result: { canceled: true } };
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Users\\WINDOWS 10\\Videos' },
  dialog: { showSaveDialog: vi.fn(async () => dialogState.result), showOpenDialog: vi.fn() },
  ipcMain: { handle: (ch: string, fn: (...a: any[]) => Promise<any>) => handlers.set(ch, fn) },
}));
const ffState = { available: true, convertFails: true };
vi.mock('../src/main/ffmpeg', () => ({
  detectFfmpeg: vi.fn(async () => ({ available: ffState.available, version: '7.0' })),
  convertToMp4: vi.fn(async (_src: string, dst: string) => {
    if (ffState.convertFails) throw new Error('ffmpeg exploded');
    await writeFile(dst, 'mp4');
  }),
}));

import { copyUnique, registerIpc } from '../src/main/ipc-handlers';
import { RecordingWriters } from '../src/main/recording-writer';
import { IPC } from '../src/shared/ipc';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const wc = {};
const good = { sender: wc } as any;
let dir: string;
let tempDir: string;
let out: string;
let writers: RecordingWriters;

const call = (ch: string, ...a: any[]) => handlers.get(ch)!(good, ...a);
const finish = (sessionId: string, wantMp4 = false) =>
  call(IPC.recFinish, { sessionId, suggestedName: 'rec_1', wantMp4 });

async function newSession(): Promise<{ sessionId: string; filePath: string }> {
  const b = await writers.begin();
  await writers.write(b.sessionId, new Uint8Array([7, 7, 7]));
  return b;
}

beforeEach(async () => {
  handlers.clear();
  dir = await mkdtemp(join(tmpdir(), 'save test '));
  tempDir = join(dir, 'tmp');
  out = join(dir, 'out');
  await mkdir(out);
  writers = new RecordingWriters(tempDir);
  ffState.available = true;
  ffState.convertFails = true;
  registerIpc({
    getWindow: () => ({ webContents: wc }) as any,
    settings: { get: () => DEFAULT_SETTINGS, save: vi.fn() } as any,
    writers,
    allowedImagePaths: new Set(),
  });
});
afterEach(async () => {
  await writers.disposeAll();
  await rm(dir, { recursive: true, force: true });
});

describe('F1: temp recording lifecycle', () => {
  it('cancel keeps session and temp file, and retry can then succeed', async () => {
    const { sessionId, filePath } = await newSession();
    dialogState.result = { canceled: true };
    expect(await finish(sessionId)).toEqual({ status: 'cancelled' });
    expect(writers.has(sessionId)).toBe(true);
    expect(await readdir(tempDir)).toHaveLength(1);

    const target = join(out, 'a.webm');
    dialogState.result = { canceled: false, filePath: target };
    const r = await finish(sessionId);
    expect(r).toMatchObject({ status: 'saved', path: target, format: 'webm' });
    expect(Array.from(await readFile(target))).toEqual([7, 7, 7]);
    expect(writers.has(sessionId)).toBe(false);
    await expect(readFile(filePath)).rejects.toThrow();
  });

  it('copy error keeps session and temp file and is flagged retryable', async () => {
    const { sessionId } = await newSession();
    dialogState.result = { canceled: false, filePath: join(out, 'missing-dir', 'a.webm') };
    const r = await finish(sessionId);
    expect(r).toMatchObject({ status: 'error', retryable: true });
    expect(writers.has(sessionId)).toBe(true);
    expect(await readdir(tempDir)).toHaveLength(1);
  });

  it('saved removes session and temp file', async () => {
    const { sessionId } = await newSession();
    dialogState.result = { canceled: false, filePath: join(out, 'ok.webm') };
    expect((await finish(sessionId)).status).toBe('saved');
    expect(writers.has(sessionId)).toBe(false);
    expect(await readdir(tempDir)).toEqual([]);
  });

  it('explicit discard (recording:abort) after cancel removes session and temp file', async () => {
    const { sessionId } = await newSession();
    dialogState.result = { canceled: true };
    await finish(sessionId);
    await call(IPC.recAbort, sessionId);
    expect(writers.has(sessionId)).toBe(false);
    expect(await readdir(tempDir)).toEqual([]);
  });

  it('invalid request does not drop the session', async () => {
    const { sessionId } = await newSession();
    await call(IPC.recFinish, { sessionId, suggestedName: '../x', wantMp4: false });
    expect(writers.has(sessionId)).toBe(true);
  });
});

describe('F2: webm fallback never overwrites', () => {
  it('ffmpeg failure -> webm fallback with a unique name and the final path in the note', async () => {
    const { sessionId } = await newSession();
    await writeFile(join(out, 'v.webm'), 'precious');
    await writeFile(join(out, 'v (1).webm'), 'precious too');
    dialogState.result = { canceled: false, filePath: join(out, 'v.mp4') };
    const r = await finish(sessionId, true);
    const expected = join(out, 'v (2).webm');
    expect(r).toMatchObject({ status: 'saved', path: expected, format: 'webm' });
    expect(r.note).toContain(expected);
    expect(await readFile(join(out, 'v.webm'), 'utf8')).toBe('precious');
    expect(await readFile(join(out, 'v (1).webm'), 'utf8')).toBe('precious too');
    expect(Array.from(await readFile(expected))).toEqual([7, 7, 7]);
    expect(await readdir(out)).not.toContain('v.mp4');
    expect(writers.has(sessionId)).toBe(false);
  });

  it('ffmpeg failure with no clash uses the plain .webm name', async () => {
    const { sessionId } = await newSession();
    dialogState.result = { canceled: false, filePath: join(out, 'v.mp4') };
    const r = await finish(sessionId, true);
    expect(r).toMatchObject({ status: 'saved', path: join(out, 'v.webm') });
  });

  it('ffmpeg success writes the mp4', async () => {
    ffState.convertFails = false;
    const { sessionId } = await newSession();
    dialogState.result = { canceled: false, filePath: join(out, 'v.mp4') };
    expect(await finish(sessionId, true)).toMatchObject({ status: 'saved', format: 'mp4', path: join(out, 'v.mp4') });
  });

  it('copyUnique never overwrites and keeps the extension', async () => {
    const src = join(dir, 'src.bin');
    await writeFile(src, 'new');
    const target = join(out, 'x.webm');
    await writeFile(target, 'old');
    expect(await copyUnique(src, target)).toBe(join(out, 'x (1).webm'));
    expect(await readFile(target, 'utf8')).toBe('old');
  });
});
