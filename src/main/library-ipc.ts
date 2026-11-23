import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import * as fsp from 'node:fs/promises';
import { IPC } from '../shared/ipc';
import type { ExportResult, LibraryActionResult, LibraryItem, TrimResult } from '../shared/ipc';
import { isLibraryId, type LibraryEntry } from '../shared/library';
import { validateTrim } from '../shared/trim';
import { exportRecording } from './export';
import { detectFfmpeg } from './ffmpeg';
import type { LibraryStore } from './library-store';
import { trimRecording } from './trim';

/** Runs `fn` unless another export/trim is in flight, in which case it resolves to a clear error. */
export type Exclusive = <R extends { status: string }>(fn: () => Promise<R>) => Promise<R | { status: 'error'; message: string }>;

export interface LibraryIpcDeps {
  getWindow: () => BrowserWindow | null;
  assertSender: (e: IpcMainInvokeEvent) => void;
  library?: LibraryStore;
  exclusive: Exclusive;
  /** Called with the path of a recording that was trashed (drops stale "last saved" state). */
  onForget?: (path: string) => void;
}

/** Index a freshly saved file; indexing problems never fail the save itself. */
export async function recordSaved(library: LibraryStore | undefined, filePath: string, durationSec: number | null = null): Promise<void> {
  if (!library) return;
  try {
    await library.add(filePath, (await fsp.stat(filePath)).size, durationSec);
  } catch { /* the recording is saved either way */ }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NO_LIBRARY = { status: 'error', message: 'Recording library is unavailable' } as const;

async function existingFile(p: string): Promise<boolean> {
  try { return (await fsp.stat(p)).isFile(); } catch { return false; }
}

export function registerLibraryIpc(deps: LibraryIpcDeps): void {
  const { library, assertSender, getWindow } = deps;

  /** Look up an entry by renderer-supplied id; the id is validated, the path comes from the main-held index. */
  const entryFor = (id: unknown): LibraryEntry | { status: 'error'; message: string } => {
    if (!library) return NO_LIBRARY;
    const entry = isLibraryId(id) ? library.get(id) : undefined;
    return entry ?? { status: 'error', message: 'Unknown recording' };
  };
  const isError = (v: LibraryEntry | { status: 'error' }): v is { status: 'error'; message: string } => 'status' in v;

  ipcMain.handle(IPC.libraryList, async (e): Promise<LibraryItem[]> => {
    assertSender(e);
    return library ? library.list() : [];
  });

  ipcMain.handle(IPC.libraryOpen, async (e, id: unknown): Promise<LibraryActionResult> => {
    assertSender(e);
    const entry = entryFor(id);
    if (isError(entry)) return entry;
    if (!(await existingFile(entry.path))) return { status: 'error', message: 'The file no longer exists' };
    const err = await shell.openPath(entry.path);
    return err ? { status: 'error', message: err } : { status: 'ok' };
  });

  ipcMain.handle(IPC.libraryReveal, async (e, id: unknown): Promise<LibraryActionResult> => {
    assertSender(e);
    const entry = entryFor(id);
    if (isError(entry)) return entry;
    if (!(await existingFile(entry.path))) return { status: 'error', message: 'The file no longer exists' };
    shell.showItemInFolder(entry.path);
    return { status: 'ok' };
  });

  ipcMain.handle(IPC.libraryDelete, async (e, id: unknown): Promise<LibraryActionResult> => {
    assertSender(e);
    const entry = entryFor(id);
    if (isError(entry)) return entry;
    const exists = await existingFile(entry.path);
    const opts = {
      type: 'warning' as const,
      title: exists ? 'Delete recording' : 'Remove from library',
      message: exists ? `Move "${entry.name}" to the Recycle Bin?` : `"${entry.name}" no longer exists. Remove it from the library?`,
      buttons: [exists ? 'Move to Recycle Bin' : 'Remove', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const win = getWindow();
    const answer = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (answer.response !== 0) return { status: 'cancelled' };
    try {
      if (exists) await shell.trashItem(entry.path);
      await library!.remove(entry.id);
      deps.onForget?.(entry.path);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', message: errMsg(err) };
    }
  });

  ipcMain.handle(IPC.libraryExport, async (e, id: unknown, format: unknown): Promise<ExportResult> => {
    assertSender(e);
    if (format !== 'mp4' && format !== 'gif') return { status: 'error', message: 'Invalid export format' };
    const entry = entryFor(id);
    if (isError(entry)) return entry;
    return deps.exclusive(() => exportRecording(getWindow(), entry.path, format));
  });

  ipcMain.handle(IPC.libraryTrim, async (e, raw: unknown): Promise<TrimResult> => {
    assertSender(e);
    const req = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const entry = entryFor(req.id);
    if (isError(entry)) return entry;
    const range = validateTrim(req.startSec, req.endSec, req.durationSec ?? entry.durationSec);
    if (!range.ok) return { status: 'error', message: range.message };
    return deps.exclusive(async (): Promise<TrimResult> => {
      if (!(await existingFile(entry.path))) return { status: 'error', message: 'The file no longer exists' };
      if (!(await detectFfmpeg()).available) return { status: 'error', message: 'ffmpeg is not available' };
      try {
        const out = await trimRecording(entry.path, range.start, range.end);
        await recordSaved(library, out, range.end - range.start);
        return { status: 'saved', path: out };
      } catch (err) {
        return { status: 'error', message: errMsg(err) };
      }
    });
  });
}
