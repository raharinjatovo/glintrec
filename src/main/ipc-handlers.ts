import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { constants as fsConstants } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { IPC, IPC_EVENTS } from '../shared/ipc';
import type {
  BeginRecordingResult, ExportResult, FfmpegStatus, FinishRequest, FinishResult, FloatingOverlayConfig,
  HotkeyStatus, LoadImageResult, OpenMobileBrowserResult, PickImageResult, ScreenshotResult,
} from '../shared/ipc';
import type { HotkeyManager } from './hotkeys';
import { exportRecording } from './export';
import { toPngBytes, writeScreenshot } from './screenshot';
import type { FloatingOverlay } from './overlay-window';
import { sanitizeSettings } from '../shared/settings';
import type { SettingsStore } from './settings-store';
import type { RecordingWriters } from './recording-writer';
import { convertToMp4, detectFfmpeg } from './ffmpeg';
import { listCaptureSources } from './sources';
import { setSelectedSource } from './capture-selection';
import type { LibraryStore } from './library-store';
import { recordSaved, registerLibraryIpc, type Exclusive } from './library-ipc';
import { registerInputIpc } from './input-ipc';
import type { InputSession } from './input-session';
import type { ZoomHud } from './zoom-hud-window';
import type { ControlHud } from './control-hud-window';
import { sanitizeControlHudState } from '../shared/control-hud';
import { sanitizeZoomHudUpdate } from '../shared/zoom-hud';
import type { CaptureFrame } from './capture-frame-window';
import { sanitizeCaptureRegion } from '../shared/capture-region';
import type { MobileBrowser } from './mobile-browser';

export interface IpcDeps {
  getWindow: () => BrowserWindow | null;
  settings: SettingsStore;
  writers: RecordingWriters;
  allowedImagePaths: Set<string>;
  library?: LibraryStore;
  overlay?: FloatingOverlay;
  hotkeys?: HotkeyManager;
  /** Global mouse/keyboard feed for recording effects; stopped whenever a recording is finished or aborted. */
  input?: InputSession;
  /** Zoom indicator window; follows the effects.zoomHud setting and the renderer's zoom updates. */
  zoomHud?: ZoomHud;
  /** Floating pause / mode / stop toolbar shown while recording. */
  controlHud?: ControlHud;
  /** Desktop outline of the zoomed/cropped part of the screen; follows effects.zoomHud too. */
  captureFrame?: CaptureFrame;
  /** Phone-shaped browser window the user can record in mobile format. */
  mobileBrowser?: MobileBrowser;
}

function sanitizeOverlayConfig(raw: unknown, allowedImages: Set<string>): FloatingOverlayConfig {
  const s = sanitizeSettings({ overlay: (raw as { overlay?: unknown } | null)?.overlay ?? raw }).overlay;
  const bg = sanitizeSettings({ background: (raw as { background?: unknown } | null)?.background }).background;
  if (bg.imagePath && !allowedImages.has(bg.imagePath)) bg.imagePath = null;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cam = typeof r.cameraDeviceId === 'string' && r.cameraDeviceId.length > 0 && r.cameraDeviceId.length < 2048
    ? r.cameraDeviceId : null;
  return {
    cameraDeviceId: cam, shape: s.shape, sizePercent: s.sizePercent, pos: s.pos, corner: s.corner,
    mirror: s.mirror, border: s.border, background: bg,
  };
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function registerIpc(deps: IpcDeps): void {
  const { getWindow, settings, writers, allowedImagePaths } = deps;
  let ffmpegCache: FfmpegStatus | null = null;
  /** Path of the last recording saved this session: the only input export is allowed to read. */
  let lastSavedPath: string | null = null;

  const assertSender = (e: IpcMainInvokeEvent) => {
    const win = getWindow();
    if (!win || e.sender !== win.webContents) throw new Error('Untrusted sender');
  };

  /** One export/trim at a time, enforced here (the renderer guard alone is not a security boundary). */
  let exportBusy = false;
  const exclusive: Exclusive = async (fn) => {
    if (exportBusy) return { status: 'error', message: 'Another export is already running' };
    exportBusy = true;
    try {
      return await fn();
    } finally {
      exportBusy = false;
    }
  };
  registerLibraryIpc({
    getWindow, assertSender, library: deps.library, exclusive,
    onForget: (p) => { if (lastSavedPath === p) lastSavedPath = null; },
  });

  registerInputIpc({ assertSender, session: deps.input, isRecording: () => writers.hasActive?.() ?? true });

  ipcMain.handle(IPC.listSources, async (e) => {
    assertSender(e);
    return listCaptureSources(getWindow());
  });

  ipcMain.handle(IPC.selectCaptureSource, async (e, id: unknown) => {
    assertSender(e);
    setSelectedSource(id);
  });

  ipcMain.handle(IPC.getSettings, async (e) => {
    assertSender(e);
    const s = settings.get();
    if (s.background.imagePath) allowedImagePaths.add(s.background.imagePath);
    return s;
  });

  ipcMain.handle(IPC.saveSettings, async (e, raw: unknown) => {
    assertSender(e);
    const clean = sanitizeSettings(raw);
    const imagePath = clean.background.imagePath;
    if (imagePath && !allowedImagePaths.has(imagePath)) clean.background.imagePath = null;
    await settings.save(clean);
    deps.zoomHud?.setEnabled(clean.effects.zoomHud);
    deps.captureFrame?.setEnabled(clean.effects.zoomHud);
    if (deps.hotkeys) {
      const status = deps.hotkeys.apply(clean.hotkeys);
      getWindow()?.webContents.send(IPC_EVENTS.hotkeyStatus, status);
    }
  });

  ipcMain.handle(IPC.zoomHudUpdate, async (e, raw: unknown) => {
    assertSender(e);
    const u = sanitizeZoomHudUpdate(raw);
    if (u) deps.zoomHud?.update(u);
  });

  ipcMain.handle(IPC.controlHudState, async (e, raw: unknown) => {
    assertSender(e);
    deps.controlHud?.update(raw === null ? null : sanitizeControlHudState(raw));
  });

  ipcMain.handle(IPC.captureFrameUpdate, async (e, raw: unknown) => {
    assertSender(e);
    deps.captureFrame?.update(sanitizeCaptureRegion(raw));
  });

  ipcMain.handle(IPC.openMobileBrowser, async (e): Promise<OpenMobileBrowserResult> => {
    assertSender(e);
    if (!deps.mobileBrowser) return { sourceId: null };
    await deps.mobileBrowser.open();
    return { sourceId: deps.mobileBrowser.getMediaSourceId() };
  });

  ipcMain.handle(IPC.getHotkeyStatus, async (e): Promise<HotkeyStatus> => {
    assertSender(e);
    return deps.hotkeys?.status() ?? { registered: [], failed: [] };
  });

  ipcMain.handle(IPC.saveScreenshot, async (e, raw: unknown): Promise<ScreenshotResult> => {
    assertSender(e);
    const png = toPngBytes(raw);
    return { path: await writeScreenshot(app.getPath('videos'), png) };
  });

  ipcMain.handle(IPC.exportRecording, async (e, raw: unknown): Promise<ExportResult> => {
    assertSender(e);
    const format = (raw as { format?: unknown } | null)?.format;
    if (format !== 'mp4' && format !== 'gif') return { status: 'error', message: 'Invalid export format' };
    return exclusive(() => exportRecording(getWindow(), lastSavedPath, format));
  });

  ipcMain.handle(IPC.pickImage, async (e): Promise<PickImageResult> => {
    assertSender(e);
    const win = getWindow();
    const opts = {
      title: 'Choose background image',
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    const p = res.filePaths[0];
    if (!IMAGE_MIME[path.extname(p).toLowerCase()]) return null;
    allowedImagePaths.add(p);
    return { path: p };
  });

  ipcMain.handle(IPC.loadImage, async (e, p: unknown): Promise<LoadImageResult> => {
    assertSender(e);
    if (typeof p !== 'string' || !allowedImagePaths.has(p)) throw new Error('Image path not allowed');
    const mime = IMAGE_MIME[path.extname(p).toLowerCase()];
    if (!mime) throw new Error('Unsupported image type');
    const st = await fsp.stat(p);
    if (!st.isFile() || st.size > MAX_IMAGE_BYTES) throw new Error('Invalid image file');
    const buf = await fsp.readFile(p);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { mime, bytes };
  });

  ipcMain.handle(IPC.checkFfmpeg, async (e) => {
    assertSender(e);
    ffmpegCache = await detectFfmpeg();
    return ffmpegCache;
  });

  ipcMain.handle(IPC.recBegin, async (e): Promise<BeginRecordingResult> => {
    assertSender(e);
    const { sessionId } = await writers.begin();
    return { sessionId };
  });

  ipcMain.handle(IPC.recChunk, async (e, sessionId: unknown, chunk: unknown) => {
    assertSender(e);
    if (typeof sessionId !== 'string') throw new Error('Bad session');
    if (!(chunk instanceof ArrayBuffer) && !ArrayBuffer.isView(chunk)) throw new Error('Bad chunk');
    const u8 = chunk instanceof ArrayBuffer
      ? new Uint8Array(chunk)
      : new Uint8Array((chunk as ArrayBufferView).buffer, (chunk as ArrayBufferView).byteOffset, (chunk as ArrayBufferView).byteLength);
    if (u8.byteLength > MAX_CHUNK_BYTES) throw new Error('Chunk too large');
    await writers.write(sessionId, u8);
  });

  ipcMain.handle(IPC.recAbort, async (e, sessionId: unknown) => {
    assertSender(e);
    if (typeof sessionId !== 'string') throw new Error('Bad session');
    deps.input?.stop();
    await writers.abort(sessionId);
  });

  ipcMain.handle(IPC.overlayShow, async (e, raw: unknown) => {
    assertSender(e);
    deps.overlay?.show(sanitizeOverlayConfig(raw, allowedImagePaths));
  });
  ipcMain.handle(IPC.overlayUpdate, async (e, raw: unknown) => {
    assertSender(e);
    deps.overlay?.update(sanitizeOverlayConfig(raw, allowedImagePaths));
  });
  ipcMain.handle(IPC.overlayHide, async (e) => {
    assertSender(e);
    deps.overlay?.hide();
  });

  ipcMain.handle(IPC.recFinish, async (e, raw: unknown): Promise<FinishResult> => {
    assertSender(e);
    const req = raw as Partial<FinishRequest> | null;
    if (!req || typeof req.sessionId !== 'string' || typeof req.suggestedName !== 'string' || typeof req.wantMp4 !== 'boolean') {
      return { status: 'error', message: 'Invalid request' };
    }
    if (!SAFE_NAME.test(req.suggestedName)) return { status: 'error', message: 'Invalid file name' };
    deps.input?.stop(); // recording over: nothing may keep listening
    let tempFile: string;
    try {
      tempFile = await writers.finalize(req.sessionId);
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : 'Unknown session' };
    }
    // The session and temp file are only released after a successful save (or an explicit
    // recording:abort). On cancel or error they stay alive so the renderer can retry or discard.
    try {
      const res = await saveRecording(getWindow(), tempFile, req.suggestedName, req.wantMp4);
      if (res.status === 'saved') {
        lastSavedPath = res.path;
        await recordSaved(deps.library, res.path);
        await writers.abort(req.sessionId).catch(() => undefined);
      }
      return res;
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err), retryable: true };
    }
  });
}

/** Copy `src` to `desired`, never overwriting: on a name clash use "name (1).ext", "name (2).ext", ... */
export async function copyUnique(src: string, desired: string): Promise<string> {
  const ext = path.extname(desired);
  const base = desired.slice(0, desired.length - ext.length);
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? desired : `${base} (${i})${ext}`;
    try {
      await fsp.copyFile(src, candidate, fsConstants.COPYFILE_EXCL);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free file name');
}

export async function saveRecording(
  win: BrowserWindow | null, tempFile: string, name: string, wantMp4: boolean,
): Promise<FinishResult> {
  const ff = wantMp4 ? await detectFfmpeg() : { available: false, version: null };
  const mp4 = wantMp4 && ff.available;
  const ext = mp4 ? 'mp4' : 'webm';
  const opts = {
    title: 'Save recording',
    defaultPath: path.join(app.getPath('videos'), `${name}.${ext}`),
    filters: [{ name: mp4 ? 'MP4 video' : 'WebM video', extensions: [ext] }],
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return { status: 'cancelled' };
  const withExt = (p: string, e: string) => (p.toLowerCase().endsWith('.' + e) ? p : p.replace(/\.[^\\/.]*$/, '') + '.' + e);

  if (mp4) {
    const target = withExt(res.filePath, 'mp4');
    try {
      await convertToMp4(tempFile, target);
      return { status: 'saved', path: target, format: 'mp4' };
    } catch {
      await fsp.rm(target, { force: true }).catch(() => undefined);
      // The user confirmed a .mp4 name, not this .webm one: never overwrite an existing file.
      const fallback = await copyUnique(tempFile, withExt(res.filePath, 'webm'));
      return { status: 'saved', path: fallback, format: 'webm', note: `mp4 conversion failed, saved webm instead at ${fallback}` };
    }
  }
  const target = withExt(res.filePath, 'webm');
  await fsp.copyFile(tempFile, target);
  return {
    status: 'saved', path: target, format: 'webm',
    note: wantMp4 ? 'ffmpeg missing, saved webm' : undefined,
  };
}
