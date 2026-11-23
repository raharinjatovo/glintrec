import { BrowserWindow } from 'electron';
import type { Rect } from '../shared/overlay-layout';
import type { CaptureRegion } from '../shared/capture-region';

const ORIGIN = 'app://local';

/**
 * Click-through outline over the real desktop showing which part of the screen the recording takes when it is zoomed
 * or cropped (mobile format). Hidden from screen capture, so it never ends up in the video. The page has no preload:
 * the region is pushed with executeJavaScript as JSON of four validated numbers.
 */
export class CaptureFrame {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private enabled = true;
  private session: Rect | null = null;
  private region: CaptureRegion | null = null;

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.sync();
  }

  /** A screen recording started on the display at `area` (null = window source: nothing to outline). */
  begin(area: Rect | null): void {
    this.session = area;
    this.region = null;
    this.sync();
  }

  end(): void {
    this.session = null;
    this.region = null;
    this.sync();
  }

  update(region: CaptureRegion | null): void {
    this.region = region;
    this.push();
  }

  dispose(): void {
    this.session = null;
    this.destroy();
  }

  private sync(): void {
    if (!(this.enabled && this.session)) { this.destroy(); return; }
    if (!this.win || this.win.isDestroyed()) this.create();
    const win = this.win!;
    const r = this.session;
    const b = win.getBounds();
    if (b.x !== r.x || b.y !== r.y || b.width !== r.width || b.height !== r.height) win.setBounds(r);
    if (this.loaded && !win.isVisible()) win.showInactive();
  }

  private create(): void {
    const area = this.session!;
    const win = new BrowserWindow({
      x: area.x, y: area.y, width: area.width, height: area.height, frame: false, transparent: true, resizable: false,
      movable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, focusable: false,
      fullscreenable: false,
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
    void win.loadURL(`${ORIGIN}/renderer/capture-frame.html`);
  }

  private destroy(): void {
    const w = this.win;
    this.win = null;
    this.loaded = false;
    if (w && !w.isDestroyed()) w.destroy();
  }

  private push(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.loaded) return;
    void win.webContents.executeJavaScript(`window.__setRegion&&window.__setRegion(${JSON.stringify(this.region)})`).catch(() => undefined);
  }
}
