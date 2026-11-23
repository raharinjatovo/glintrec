import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...a: any[]) => Promise<any>>();
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Users\\WINDOWS 10\\Videos' },
  dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })), showOpenDialog: vi.fn() },
  ipcMain: { handle: (ch: string, fn: (...a: any[]) => Promise<any>) => handlers.set(ch, fn) },
}));

import { registerIpc } from '../src/main/ipc-handlers';
import { IPC } from '../src/shared/ipc';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const wc = {};
const good = { sender: wc } as any;
const bad = { sender: {} } as any;

function setup(extra: { finalize?: any } = {}) {
  handlers.clear();
  const saved: any[] = [];
  const writers: any = {
    begin: vi.fn(async () => ({ sessionId: 's1', filePath: 'x' })),
    write: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    finalize: extra.finalize ?? vi.fn(async () => 'tmp.webm'),
    remove: vi.fn(async () => undefined),
  };
  const settings: any = { get: () => DEFAULT_SETTINGS, save: vi.fn(async (s: any) => { saved.push(s); }) };
  const allowed = new Set<string>();
  registerIpc({ getWindow: () => ({ webContents: wc }) as any, settings, writers, allowedImagePaths: allowed });
  return { writers, settings, saved, allowed };
}
const call = (ch: string, e: any, ...a: any[]) => handlers.get(ch)!(e, ...a);

describe('IPC payload validation', () => {
  beforeEach(() => handlers.clear());

  it('rejects untrusted senders on every channel', async () => {
    setup();
    for (const ch of Object.values(IPC)) {
      await expect(call(ch, bad)).rejects.toThrow('Untrusted sender');
    }
  });

  it('saveSettings sanitizes garbage and drops non-whitelisted image path', async () => {
    const { saved } = setup();
    await call(IPC.saveSettings, good, { overlay: { sizePercent: 1e9, corner: 'x' }, background: { imagePath: 'C:\\evil.png' } });
    expect(saved[0].overlay.sizePercent).toBe(40);
    expect(saved[0].overlay.corner).toBe('bottom-right');
    expect(saved[0].background.imagePath).toBeNull();
    await call(IPC.saveSettings, good, 42);
    expect(saved[1]).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings keeps an image path that was previously allowed', async () => {
    const { saved, allowed } = setup();
    allowed.add('C:\\ok.png');
    await call(IPC.saveSettings, good, { background: { imagePath: 'C:\\ok.png' } });
    expect(saved[0].background.imagePath).toBe('C:\\ok.png');
  });

  it('loadImage rejects non-string and non-allowed paths', async () => {
    setup();
    await expect(call(IPC.loadImage, good, 5)).rejects.toThrow('not allowed');
    await expect(call(IPC.loadImage, good, 'C:\\Windows\\win.ini')).rejects.toThrow('not allowed');
  });

  it('recChunk rejects bad session and bad chunk types', async () => {
    const { writers } = setup();
    await expect(call(IPC.recChunk, good, 7, new ArrayBuffer(1))).rejects.toThrow('Bad session');
    await expect(call(IPC.recChunk, good, 's1', 'str')).rejects.toThrow('Bad chunk');
    await expect(call(IPC.recChunk, good, 's1', { byteLength: 1 })).rejects.toThrow('Bad chunk');
    await expect(call(IPC.recChunk, good, 's1', null)).rejects.toThrow('Bad chunk');
    expect(writers.write).not.toHaveBeenCalled();
  });

  it('recChunk accepts ArrayBuffer and typed arrays (respecting offset)', async () => {
    const { writers } = setup();
    await call(IPC.recChunk, good, 's1', new ArrayBuffer(4));
    const big = new Uint8Array([1, 2, 3, 4, 5]);
    await call(IPC.recChunk, good, 's1', big.subarray(1, 3));
    expect(writers.write.mock.calls[0][1].byteLength).toBe(4);
    expect(Array.from(writers.write.mock.calls[1][1])).toEqual([2, 3]);
  });

  it('recAbort rejects non-string session', async () => {
    setup();
    await expect(call(IPC.recAbort, good, {})).rejects.toThrow('Bad session');
  });

  it.each([
    [null], [undefined], ['str'], [{}],
    [{ sessionId: 1, suggestedName: 'a', wantMp4: true }],
    [{ sessionId: 's', suggestedName: 5, wantMp4: true }],
    [{ sessionId: 's', suggestedName: 'a', wantMp4: 'yes' }],
  ])('recFinish rejects malformed request %j', async (raw) => {
    const { writers } = setup();
    expect(await call(IPC.recFinish, good, raw)).toEqual({ status: 'error', message: 'Invalid request' });
    expect(writers.finalize).not.toHaveBeenCalled();
  });

  it.each([['..\\..\\evil'], ['a/b'], ['a b'], [''], ['x'.repeat(101)], ['C:\\x'], ['a\0b']])(
    'recFinish rejects unsafe file name %j without touching the session', async (name) => {
      const { writers } = setup();
      const r = await call(IPC.recFinish, good, { sessionId: 's', suggestedName: name, wantMp4: false });
      expect(r).toEqual({ status: 'error', message: 'Invalid file name' });
      expect(writers.finalize).not.toHaveBeenCalled();
    });

  it('recFinish reports unknown session', async () => {
    setup({ finalize: vi.fn(async () => { throw new Error('Unknown recording session'); }) });
    const r = await call(IPC.recFinish, good, { sessionId: 'nope', suggestedName: 'recording-2026-10-29-14-05-33', wantMp4: false });
    expect(r).toEqual({ status: 'error', message: 'Unknown recording session' });
  });

  it('recFinish on cancelled dialog keeps session and temp file so the user can retry or discard', async () => {
    const { writers } = setup();
    const r = await call(IPC.recFinish, good, { sessionId: 's1', suggestedName: 'rec_1.x-y', wantMp4: false });
    expect(r).toEqual({ status: 'cancelled' });
    expect(writers.finalize).toHaveBeenCalledWith('s1');
    expect(writers.abort).not.toHaveBeenCalled();
    expect(writers.remove).not.toHaveBeenCalled();
  });
});
