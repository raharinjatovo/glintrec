import { BrowserWindow } from 'electron';
import type { Rect } from '../shared/overlay-layout';
import { zoomHudRect, zoomHudView, type ZoomHudUpdate, type ZoomHudView } from '../shared/zoom-hud';

const ORIGIN = 'app://local';
const SIZE = { width: 156, height: 44 };
const MARGIN = 24;
const FLASH_MS = 1600;

/**
 * Small always-on-top pill over the real desktop that says whether the recording is zoomed and by how much.
 * Not focusable, click-through and hidden from screen capture (so it never ends up in the video). The page has no
 * preload: values are pushed with executeJavaScript as JSON of a fixed vocabulary (text, label, enum mode, fraction).
 */
export class ZoomHud {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private enabled = true;
  private session: Rect | null = null;
  private flashing = false;
  private flashTimer: NodeJS.Timeout | null = null;
  private view: ZoomHudView = zoomHudView({ factor: 1, mode: 'none' });

  /** `fallbackBounds`: display to use for a hotkey flash outside a recording. */
  constructor(private readonly fallbackBounds: () => Rect) {}

  /** The "show zoom indicator" setting; switching it off hides the HUD at once, on shows it again if recording. */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.sync();
  }

  /** A screen recording started on the display at `area` (null = no usable display: window source). */
  begin(area: Rect | null): void {
    if (!area) { this.end(); return; }
    this.session = area;
    this.view = zoomHudView({ factor: 1, mode: 'none' });
    this.clearFlash();
    this.sync();
    this.push();
  }

  /** Recording over (or app closing). */
  end(): void {
    this.session = null;
    this.clearFlash();
    this.sync();
  }

  update(u: ZoomHudUpdate): void {
    this.view = zoomHudView(u);
    if (u.flash) this.startFlash();
    if (!this.win) return; // nothing visible: not recording and no flash running
    this.push();
    if (u.flash) this.run('window.__flash&&window.__flash()');
  }

  dispose(): void {
    this.session = null;
    this.clearFlash();
    this.destroy();
  }

  private startFlash(): void {
    if (!this.enabled) return;
    this.clearFlash();
    if (!this.session) {
      this.flashing = true;
      this.flashTimer = setTimeout(() => { this.flashTimer = null; this.flashing = false; this.sync(); }, FLASH_MS);
    }
    this.sync();
  }

  private clearFlash(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
    this.flashing = false;
  }

  private sync(): void {
    if (!(this.enabled && (this.session || this.flashing))) { this.destroy(); return; }
    if (!this.win || this.win.isDestroyed()) this.create();
    const win = this.win!;
    const r = zoomHudRect(this.session ?? this.fallbackBounds(), SIZE, MARGIN, 'top-right'); // bottom-right is where the camera bubble sits
    const b = win.getBounds();
    if (b.x !== r.x || b.y !== r.y || b.width !== r.width || b.height !== r.height) win.setBounds(r);
    if (this.loaded && !win.isVisible()) win.showInactive();
  }

  private create(): void {
    const win = new BrowserWindow({
      width: SIZE.width, height: SIZE.height, frame: false, transparent: true, resizable: false, movable: false,
      hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, focusable: false, fullscreenable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true); // not part of the recording
    win.setIgnoreMouseEvents(true); // clicks go to whatever is underneath
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('did-finish-load', () => {
      if (this.win !== win || win.isDestroyed()) return;
      this.loaded = true;
      this.push();
      if (!win.isVisible()) win.showInactive();
    });
    win.on('closed', () => { if (this.win === win) { this.win = null; this.loaded = false; } });
    this.win = win;
    this.loaded = false;
    void win.loadURL(`${ORIGIN}/renderer/zoom-hud.html`);
  }

  private destroy(): void {
    const w = this.win;
    this.win = null;
    this.loaded = false;
    if (w && !w.isDestroyed()) w.destroy();
  }

  private push(): void {
    if (!this.loaded) return;
    this.run(`window.__setZoom&&window.__setZoom(${JSON.stringify(this.view)})`);
  }

  private run(js: string): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.loaded) return;
    void win.webContents.executeJavaScript(js).catch(() => undefined);
  }
}
