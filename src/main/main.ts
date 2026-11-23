import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, net, protocol, screen, session } from 'electron';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDisplayMediaResponse, getSelectedSource } from './capture-selection';
import { IPC_EVENTS } from '../shared/ipc';
import { ANNOTATION_CHANNELS, ANNOTATION_EVENT } from '../shared/annotation-strokes';
import { createHotkeyManager, type HotkeyManager } from './hotkeys';
import { registerIpc } from './ipc-handlers';
import { FloatingOverlay } from './overlay-window';
import { AnnotationOverlay } from './annotation-window';
import { ZoomHud } from './zoom-hud-window';
import { ControlHud } from './control-hud-window';
import { ANNOTATION_CONTROL_CHANNEL, CONTROL_HUD_COMMAND_CHANNEL, CONTROL_HUD_RELAY_EVENT, type ControlHudCommand } from '../shared/control-hud';
import { debugLog, initDebugLog } from './debug-log';
import { CaptureFrame } from './capture-frame-window';
import { MobileBrowser } from './mobile-browser';
import { MOBILE_BROWSER_CHANNELS } from '../shared/mobile-browser';
import { annotationDisplayBounds, describeAnnotationDisplay, selectedSourceDisplay, cursorDisplayGuess } from './capture-display';
import { createInputSession, type InputSession } from './input-session';
import { loadUiohook } from './uiohook-loader';
import { killAllFfmpeg } from './ffmpeg';
import { LibraryStore } from './library-store';
import { MEDIA_HOST, mediaIdFromUrl } from './media-route';
import { RecordingWriters } from './recording-writer';
import { SettingsStore } from './settings-store';

const distDir = path.resolve(__dirname, '..');
const tempDir = path.join(app.getPath('temp'), 'screen-recorder');
const ORIGIN = 'app://local';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
let writers: RecordingWriters | null = null;
let floating: FloatingOverlay | null = null;
let hotkeys: HotkeyManager | null = null;
let input: InputSession | null = null;
let annotation: AnnotationOverlay | null = null;
let zoomHud: ZoomHud | null = null;
let controlHud: ControlHud | null = null;
let captureFrame: CaptureFrame | null = null;
let mobileBrowser: MobileBrowser | null = null;
let library: LibraryStore | null = null;
let disposedForQuit = false;

/** Toolbar and in-overlay controls share this: runs a validated command in the main renderer (which clicks the real buttons). */
function relayControlCommand(cmd: ControlHudCommand): void {
  const ok = !!mainWindow && !mainWindow.isDestroyed();
  debugLog('[control-hud] main -> renderer relay', cmd, ok ? 'sent' : 'DROPPED: no main window');
  if (ok) mainWindow!.webContents.send(CONTROL_HUD_RELAY_EVENT, cmd);
}

/** Close open write streams and delete temp recordings (unencrypted screen + webcam). */
function disposeRecordings(): Promise<void> {
  return writers ? writers.disposeAll().catch(() => undefined) : Promise.resolve();
}

/** On quit: stop any running ffmpeg (its partial outputs are removed) and drop temp recordings. */
function disposeForQuit(): Promise<void> {
  return Promise.all([killAllFfmpeg().catch(() => undefined), disposeRecordings()]).then(() => undefined);
}

function isTrustedOrigin(origin: string | undefined): boolean {
  return !!origin && origin.startsWith(ORIGIN);
}

function setupProtocol(): void {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host === MEDIA_HOST) {
      // Preview of a saved recording: only files in the library index, addressed by id, never by path.
      const id = mediaIdFromUrl(url);
      const entry = id ? library?.get(id) : undefined;
      if (!entry) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(entry.path).toString(), { headers: req.headers });
    }
    if (url.host !== 'local') return new Response('Not found', { status: 404 });
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const resolved = path.normalize(path.join(distDir, rel));
    if (resolved !== distDir && !resolved.startsWith(distDir + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

function setupPermissions(): void {
  const ses = session.defaultSession;
  const allowed = (permission: string) => permission === 'media' || permission === 'display-capture';
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed(permission) && isTrustedOrigin(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    allowed(permission) && isTrustedOrigin(requestingOrigin));

  // getDisplayMedia() is answered with the source picked in the UI (capture:select); no system picker.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const id = getSelectedSource();
    if (!id || !isTrustedOrigin(request.securityOrigin)) { callback({}); return; }
    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const video = sources.find((s) => s.id === id);
        callback(buildDisplayMediaResponse(video, request.audioRequested));
      })
      .catch(() => callback({}));
  }, { useSystemPicker: false });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#14161a',
    title: 'Glintrec',
    icon: path.join(distDir, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  // The default menu's View > Zoom In/Out would still catch Ctrl(+Alt)+Plus/Minus/0 and scale the app's own UI instead of
  // the recording's zoom hotkeys: no menu, and the page's zoom is pinned.
  Menu.setApplicationMenu(null);
  // Chromium remembers a page zoom per origin across launches (an earlier Ctrl+Plus stays enlarged), and re-applies it on
  // every load: reset it once the page is loaded, and again whenever it changes.
  const resetPageZoom = () => { if (!win.isDestroyed()) { win.webContents.setZoomLevel(0); win.webContents.setZoomFactor(1); } };
  void win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  win.webContents.on('did-finish-load', resetPageZoom);
  win.webContents.on('zoom-changed', resetPageZoom);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && ['+', '-', '=', '0', 'Add', 'Subtract'].includes(input.key)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { mainWindow = null; floating?.dispose(); input?.stop(); zoomHud?.dispose(); controlHud?.dispose(); captureFrame?.dispose(); annotation?.dispose(); mobileBrowser?.dispose(); void disposeRecordings(); });
  // A reload / navigation or a dead renderer orphans its recording sessions: drop them.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) { floating?.hide(); input?.stop(); void disposeRecordings(); }
  });
  win.webContents.on('render-process-gone', () => { floating?.hide(); input?.stop(); void disposeRecordings(); });
  void win.loadURL(`${ORIGIN}/renderer/index.html`);
  return win;
}

async function start(): Promise<void> {
  initDebugLog(path.join(app.getPath('userData'), 'control-hud.log'));
  debugLog('[control-hud] app start, log file', path.join(app.getPath('userData'), 'control-hud.log'));
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  await settings.load();
  library = new LibraryStore(path.join(app.getPath('userData'), 'library.json'));
  await library.load();
  setupProtocol();
  setupPermissions();
  writers = new RecordingWriters(tempDir);
  floating = new FloatingOverlay((pos) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_EVENTS.overlayMoved, pos);
  });
  // The global mouse/keyboard hook only runs between input:start and input:stop (one recording).
  zoomHud = new ZoomHud(() => cursorDisplayGuess().bounds);
  zoomHud.setEnabled(settings.get().effects.zoomHud);
  controlHud = new ControlHud(
    async () => (await selectedSourceDisplay() ?? cursorDisplayGuess()).bounds,
    relayControlCommand,
  );
  ipcMain.on(CONTROL_HUD_COMMAND_CHANNEL, (e, raw: unknown) => { controlHud?.handleCommand(e.sender, raw); });
  captureFrame = new CaptureFrame();
  captureFrame.setEnabled(settings.get().effects.zoomHud);
  const hookSession = createInputSession({
    loadHook: loadUiohook,
    cursorPoint: () => screen.getCursorScreenPoint(),
    emit: (ev) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_EVENTS.inputEvent, ev); },
    resolveDisplay: selectedSourceDisplay,
    fallbackDisplay: () => (getSelectedSource()?.startsWith('screen:') ? cursorDisplayGuess() : null),
  });
  // The zoom indicator lives exactly as long as the input session (screen recording): stop() is called on every way out.
  input = {
    ...hookSession,
    async start(req) {
      const res = await hookSession.start(req);
      if (hookSession.active()) {
        zoomHud?.begin(res.display ? res.display.bounds : null);
        captureFrame?.begin(res.display ? res.display.bounds : null);
      } else { zoomHud?.end(); captureFrame?.end(); }
      return res;
    },
    stop() { hookSession.stop(); zoomHud?.end(); captureFrame?.end(); },
  };
  annotation = new AnnotationOverlay(annotationDisplayBounds, () => settings.get().hotkeys.annotate, {
    emit: (ev) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ANNOTATION_EVENT, ev); },
    describeDisplay: describeAnnotationDisplay,
    // The draw overlay covers the whole display: it goes click-through over the control toolbar so its buttons still work.
    passThroughRects: () => [controlHud?.getRect() ?? null],
    // Controls rendered inside the overlay (this window demonstrably gets clicks): same validated command path.
    onControl: relayControlCommand,
    // While drawing, the standalone toolbar window is hidden; it comes back when the overlay stops taking input / closes.
    onDrawingChange: (drawing) => { controlHud?.setSuppressed(drawing); },
    // Mobile output: the control toolbar docks next to the annotation bar and follows it; otherwise it stays top-centre.
    barRect: (r) => { controlHud?.setAnchor(r && settings.get().outputFormat === 'mobile' ? r : null); },
  });
  // Fire-and-forget messages from the draw overlay page; the overlay checks the sender and validates the payload.
  ipcMain.on(ANNOTATION_CHANNELS.stroke, (e, raw: unknown) => { annotation?.handleStroke(e.sender, raw); });
  ipcMain.on(ANNOTATION_CHANNELS.bar, (e, raw: unknown) => { annotation?.handleBar(e.sender, raw); });
  ipcMain.on(ANNOTATION_CHANNELS.clear, (e) => { annotation?.handleClear(e.sender); });
  ipcMain.on(ANNOTATION_CONTROL_CHANNEL, (e, raw: unknown) => { annotation?.handleControl(e.sender, raw); });
  controlHud.setViewListener((v) => { annotation?.setControlView(v); });
  mobileBrowser = new MobileBrowser(() => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize, distDir);
  // The toolbar follows the mobile window in mobile output (the annotation bar, when present, takes priority).
  controlHud.setMobileOutput(() => settings.get().outputFormat === 'mobile');
  mobileBrowser.setFrameListener((r) => { controlHud?.setMobileFrame(r ? { bar: r, area: screen.getDisplayMatching(r).bounds } : null); });
  ipcMain.on(MOBILE_BROWSER_CHANNELS.command, (e, raw: unknown) => { mobileBrowser?.handleCommand(e.sender, raw); });
  hotkeys = createHotkeyManager(globalShortcut, (action) => {
    if (action === 'annotate') { void annotation?.toggle().catch(() => undefined); return; }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_EVENTS.hotkeyTriggered, action);
  });
  hotkeys.apply(settings.get().hotkeys);
  registerIpc({
    getWindow: () => mainWindow,
    settings,
    writers,
    allowedImagePaths: new Set<string>(),
    library,
    overlay: floating,
    hotkeys,
    input,
    zoomHud,
    controlHud,
    captureFrame: captureFrame ?? undefined,
    mobileBrowser,
  });
  mainWindow = createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(start).catch((err) => {
    console.error('Startup failed', err);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { hotkeys?.dispose(); input?.stop(); zoomHud?.dispose(); controlHud?.dispose(); captureFrame?.dispose(); annotation?.dispose(); mobileBrowser?.dispose(); globalShortcut.unregisterAll(); });
  app.on('before-quit', (e) => {
    hotkeys?.dispose();
    input?.stop();
    zoomHud?.dispose();
    controlHud?.dispose();
    annotation?.dispose();
    mobileBrowser?.dispose();
    if (disposedForQuit) return;
    e.preventDefault();
    disposedForQuit = true;
    void disposeForQuit().finally(() => app.quit());
  });
}
