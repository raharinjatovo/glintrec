import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...a: any[]) => Promise<any>>();
const videos = path.join(os.tmpdir(), `sr-features-ipc-${process.pid}`);
vi.mock('electron', () => ({
  app: { getPath: () => videos },
  dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })), showOpenDialog: vi.fn() },
  ipcMain: { handle: (ch: string, fn: (...a: any[]) => Promise<any>) => handlers.set(ch, fn) },
}));

import { registerIpc } from '../src/main/ipc-handlers';
import { IPC, IPC_EVENTS } from '../src/shared/ipc';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const send = vi.fn();
const wc = { send };
const good = { sender: wc } as any;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

function setup(hotkeys?: any) {
  handlers.clear();
  send.mockClear();
  const settings: any = { get: () => DEFAULT_SETTINGS, save: vi.fn(async () => undefined) };
  const writers: any = { abort: vi.fn(), finalize: vi.fn() };
  registerIpc({ getWindow: () => ({ webContents: wc }) as any, settings, writers, allowedImagePaths: new Set(), hotkeys });
}
const call = (ch: string, ...a: any[]) => handlers.get(ch)!(good, ...a);

describe('screenshot / export / hotkey IPC', () => {
  beforeEach(() => setup());

  it('saveScreenshot writes a PNG into the videos folder', async () => {
    const r = await call(IPC.saveScreenshot, PNG.buffer.slice(0));
    expect(path.dirname(r.path)).toBe(videos);
    expect(path.basename(r.path)).toMatch(/^screenshot-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.png$/);
    expect(new Uint8Array(await fsp.readFile(r.path))).toEqual(PNG);
    await fsp.rm(videos, { recursive: true, force: true });
  });

  it('saveScreenshot rejects non-PNG and non-binary payloads', async () => {
    await expect(call(IPC.saveScreenshot, 'x')).rejects.toThrow('Bad screenshot');
    await expect(call(IPC.saveScreenshot, new Uint8Array(32).buffer)).rejects.toThrow('not a PNG');
  });

  it('exportRecording validates the format and needs a saved recording first', async () => {
    expect(await call(IPC.exportRecording, { format: 'avi' })).toEqual({ status: 'error', message: 'Invalid export format' });
    expect(await call(IPC.exportRecording, null)).toEqual({ status: 'error', message: 'Invalid export format' });
    expect(await call(IPC.exportRecording, { format: 'gif', path: 'C:\\evil.exe' }))
      .toEqual({ status: 'error', message: 'No saved recording to export yet' });
  });

  it('hotkey status defaults to empty without a manager', async () => {
    expect(await call(IPC.getHotkeyStatus)).toEqual({ registered: [], failed: [] });
  });

  it('saveSettings re-applies sanitized hotkeys and notifies the renderer', async () => {
    const status = { registered: ['toggle'], failed: [] };
    const hotkeys = { apply: vi.fn(() => status), status: vi.fn(() => status), dispose: vi.fn() };
    setup(hotkeys);
    await call(IPC.saveSettings, { hotkeys: { toggle: 'ctrl+alt+k', pause: 'bogus', screenshot: '' } });
    expect(hotkeys.apply).toHaveBeenCalledWith({
      toggle: 'Control+Alt+K', pause: DEFAULT_SETTINGS.hotkeys.pause, screenshot: '', annotate: DEFAULT_SETTINGS.hotkeys.annotate,
      zoomIn: DEFAULT_SETTINGS.hotkeys.zoomIn, zoomOut: DEFAULT_SETTINGS.hotkeys.zoomOut, zoomReset: DEFAULT_SETTINGS.hotkeys.zoomReset, toggleCamera: DEFAULT_SETTINGS.hotkeys.toggleCamera,
    });
    expect(send).toHaveBeenCalledWith(IPC_EVENTS.hotkeyStatus, status);
    expect(await call(IPC.getHotkeyStatus)).toBe(status);
  });
});
