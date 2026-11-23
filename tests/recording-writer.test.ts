import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordingWriters } from '../src/main/recording-writer';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'rw test ')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('RecordingWriters', () => {
  it('hasActive is false once a session is finalized (input hook must not restart during a save retry)', async () => {
    const w = new RecordingWriters(dir);
    expect(w.hasActive()).toBe(false);
    const { sessionId } = await w.begin();
    expect(w.hasActive()).toBe(true);
    await w.finalize(sessionId);
    expect(w.has(sessionId)).toBe(true);
    expect(w.hasActive()).toBe(false);
  });
  it('writes chunks in order and close returns the file (dir with spaces)', async () => {
    const w = new RecordingWriters(join(dir, 'sub dir'));
    const { sessionId, filePath } = await w.begin();
    expect(w.has(sessionId)).toBe(true);
    await w.write(sessionId, new Uint8Array([1, 2]));
    await w.write(sessionId, new Uint8Array([3]));
    expect(await w.close(sessionId)).toBe(filePath);
    expect(Array.from(await readFile(filePath))).toEqual([1, 2, 3]);
    expect(w.has(sessionId)).toBe(false);
  });
  it('keeps sessions isolated', async () => {
    const w = new RecordingWriters(dir);
    const a = await w.begin();
    const b = await w.begin();
    expect(a.sessionId).not.toBe(b.sessionId);
    await w.write(a.sessionId, new Uint8Array([9]));
    await w.write(b.sessionId, new Uint8Array([8, 8]));
    await w.close(a.sessionId);
    await w.close(b.sessionId);
    expect((await readFile(a.filePath)).length).toBe(1);
    expect((await readFile(b.filePath)).length).toBe(2);
  });
  it('rejects unknown sessions', async () => {
    const w = new RecordingWriters(dir);
    await expect(w.write('x', new Uint8Array(1))).rejects.toThrow('Unknown recording session');
    await expect(w.close('x')).rejects.toThrow('Unknown recording session');
    await expect(w.abort('x')).resolves.toBeUndefined();
  });
  it('abort deletes the temp file', async () => {
    const w = new RecordingWriters(dir);
    const { sessionId } = await w.begin();
    await w.write(sessionId, new Uint8Array([1]));
    await w.abort(sessionId);
    expect(await readdir(dir)).toEqual([]);
  });
  it('write after close is rejected', async () => {
    const w = new RecordingWriters(dir);
    const { sessionId } = await w.begin();
    await w.close(sessionId);
    await expect(w.write(sessionId, new Uint8Array(1))).rejects.toThrow();
  });
  it('remove tolerates missing file', async () => {
    await expect(new RecordingWriters(dir).remove(join(dir, 'nope.webm'))).resolves.toBeUndefined();
  });
  it('finalize keeps session and file; abort then removes both', async () => {
    const w = new RecordingWriters(dir);
    const { sessionId, filePath } = await w.begin();
    await w.write(sessionId, new Uint8Array([1, 2]));
    expect(await w.finalize(sessionId)).toBe(filePath);
    expect(await w.finalize(sessionId)).toBe(filePath);
    expect(w.has(sessionId)).toBe(true);
    await expect(w.write(sessionId, new Uint8Array(1))).rejects.toThrow('closed');
    expect(Array.from(await readFile(filePath))).toEqual([1, 2]);
    await w.abort(sessionId);
    expect(w.has(sessionId)).toBe(false);
    expect(await readdir(dir)).toEqual([]);
  });
  it('disposeAll ends open streams and deletes all temp files', async () => {
    const w = new RecordingWriters(dir);
    const a = await w.begin();
    const b = await w.begin();
    await w.write(a.sessionId, new Uint8Array([1]));
    await w.finalize(b.sessionId);
    await w.disposeAll();
    expect(w.has(a.sessionId)).toBe(false);
    expect(w.has(b.sessionId)).toBe(false);
    expect(await readdir(dir)).toEqual([]);
    await expect(w.write(a.sessionId, new Uint8Array(1))).rejects.toThrow('Unknown');
    await expect(w.disposeAll()).resolves.toBeUndefined();
  });
});
