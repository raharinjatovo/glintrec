import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...a: any[]) => Promise<any>>();
const gate: { release?: () => void } = {};
const { shellMock, dialogMock } = vi.hoisted(() => ({
  shellMock: { openPath: vi.fn(async (_p: string) => ''), showItemInFolder: vi.fn(), trashItem: vi.fn(async (_p: string) => undefined) },
  dialogMock: {
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    showMessageBox: vi.fn(async () => ({ response: 0 })),
    showOpenDialog: vi.fn(),
  },
}));
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  dialog: dialogMock,
  shell: shellMock,
  ipcMain: { handle: (ch: string, fn: (...a: any[]) => Promise<any>) => handlers.set(ch, fn) },
}));
const ffState = { available: true };
vi.mock('../src/main/ffmpeg', () => ({
  detectFfmpeg: vi.fn(async () => ({ available: ffState.available, version: '7' })),
  convertToMp4: vi.fn(),
  convertToGif: vi.fn(),
  trimToMp4: vi.fn(async (_i: string, out: string) => {
    await new Promise<void>((r) => { gate.release = r; });
    await fsp.writeFile(out, 'trimmed');
  }),
}));

import { registerIpc } from '../src/main/ipc-handlers';
import { LibraryStore } from '../src/main/library-store';
import { IPC } from '../src/shared/ipc';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const wc = {};
const good = { sender: wc } as any;
const bad = { sender: {} } as any;
let dir: string;
let library: LibraryStore;
let id: string;
let file: string;

const mem = (files: Record<string, string> = {}) => ({
  readFile: async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
  writeFile: async (p: string, d: string) => { files[p] = d; },
  rename: async (a: string, b: string) => { files[b] = files[a]; delete files[a]; },
  mkdir: async () => undefined,
});
const call = (ch: string, ...a: any[]) => handlers.get(ch)!(good, ...a);

beforeEach(async () => {
  handlers.clear();
  vi.clearAllMocks();
  dialogMock.showMessageBox.mockResolvedValue({ response: 0 });
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lib ipc '));
  file = path.join(dir, 'rec.mp4');
  await fsp.writeFile(file, 'video');
  library = new LibraryStore(path.join(dir, 'library.json'), mem());
  id = (await library.add(file, 5, 10)).id;
  const settings: any = { get: () => DEFAULT_SETTINGS, save: vi.fn() };
  registerIpc({ getWindow: () => ({ webContents: wc }) as any, settings, writers: {} as any, allowedImagePaths: new Set(), library });
});

describe('library IPC', () => {
  it('rejects untrusted senders on every library channel', async () => {
    for (const ch of [IPC.libraryList, IPC.libraryOpen, IPC.libraryReveal, IPC.libraryDelete, IPC.libraryExport, IPC.libraryTrim]) {
      await expect(handlers.get(ch)!(bad)).rejects.toThrow('Untrusted sender');
    }
    expect(shellMock.openPath).not.toHaveBeenCalled();
  });

  it('lists items without paths', async () => {
    const items = await call(IPC.libraryList);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, name: 'rec.mp4', missing: false });
    expect(JSON.stringify(items)).not.toContain(dir);
  });

  it.each([[undefined], [null], [5], [{}], ['../../etc/passwd'], ['C:\\Windows\\system32\\cmd.exe'], ['0'.repeat(16)]])(
    'open/reveal/delete reject bad id %j', async (bogus) => {
      for (const ch of [IPC.libraryOpen, IPC.libraryReveal, IPC.libraryDelete]) {
        expect((await call(ch, bogus)).status).toBe('error');
      }
      expect(shellMock.openPath).not.toHaveBeenCalled();
      expect(shellMock.trashItem).not.toHaveBeenCalled();
    });

  it('opens and reveals by id, using the stored path', async () => {
    expect(await call(IPC.libraryOpen, id)).toEqual({ status: 'ok' });
    expect(shellMock.openPath).toHaveBeenCalledWith(file);
    expect(await call(IPC.libraryReveal, id)).toEqual({ status: 'ok' });
    expect(shellMock.showItemInFolder).toHaveBeenCalledWith(file);
  });

  it('delete asks for confirmation in main and trashes the file', async () => {
    dialogMock.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await call(IPC.libraryDelete, id)).toEqual({ status: 'cancelled' });
    expect(shellMock.trashItem).not.toHaveBeenCalled();
    expect(await call(IPC.libraryDelete, id)).toEqual({ status: 'ok' });
    expect(shellMock.trashItem).toHaveBeenCalledWith(file);
    expect(await call(IPC.libraryList)).toEqual([]);
  });

  it('export validates format and id', async () => {
    expect(await call(IPC.libraryExport, id, 'avi')).toEqual({ status: 'error', message: 'Invalid export format' });
    expect((await call(IPC.libraryExport, 'nope', 'mp4')).status).toBe('error');
  });

  it.each([
    [null], ['x'], [{ id }], [{ id, startSec: 'a', endSec: 2 }], [{ id, startSec: 3, endSec: 1 }],
    [{ id, startSec: 0, endSec: NaN }], [{ id, startSec: 0, endSec: 2, durationSec: -4 }], [{ id: 'bad', startSec: 0, endSec: 2 }],
  ])('trim rejects malformed request %j', async (raw) => {
    expect((await call(IPC.libraryTrim, raw)).status).toBe('error');
  });

  it('trim refuses when ffmpeg is missing', async () => {
    ffState.available = false;
    expect(await call(IPC.libraryTrim, { id, startSec: 0, endSec: 2 })).toEqual({ status: 'error', message: 'ffmpeg is not available' });
    ffState.available = true;
  });

  it('allows only one export/trim at a time and then recovers', async () => {
    const first = call(IPC.libraryTrim, { id, startSec: 0, endSec: 2 });
    await vi.waitFor(() => expect(gate.release).toBeDefined());
    expect(await call(IPC.libraryTrim, { id, startSec: 0, endSec: 2 }))
      .toEqual({ status: 'error', message: 'Another export is already running' });
    expect(await call(IPC.libraryExport, id, 'gif')).toEqual({ status: 'error', message: 'Another export is already running' });
    expect(await call(IPC.exportRecording, { format: 'mp4' })).toEqual({ status: 'error', message: 'Another export is already running' });
    gate.release!();
    const done = await first;
    expect(done.status).toBe('saved');
    expect(path.basename(done.path)).toBe('rec-trim.mp4');
    // The trimmed copy is indexed too, and the lock is free again.
    expect(await call(IPC.libraryList)).toHaveLength(2);
    expect(await call(IPC.exportRecording, { format: 'mp4' })).toEqual({ status: 'error', message: 'No saved recording to export yet' });
  });
});
