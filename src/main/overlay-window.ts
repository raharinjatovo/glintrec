import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { FloatingOverlayConfig } from '../shared/ipc';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { overlayRectFor, windowOriginToPos, type OverlayPos, type Rect } from '../shared/overlay-layout';

const ORIGIN = 'app://local';
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Floating always-on-top camera bubble; hidden from screen capture so it is not recorded twice. */
export class FloatingOverlay {
  private win: BrowserWindow | null = null;
  private cfg: FloatingOverlayConfig | null = null;
  /** Display the bubble was last on; reused when the window is recreated. */
  private area: Rect | null = null;
  private lastOrigin = { x: NaN, y: NaN };
  private dragging = false;
  private applyingUntil = 0;
  /** Last background pushed to the bubble page (reset when the page reloads). */
  private bgKey = '';
  private imageCache: { path: string; payload: { mime: string; b64: string } | null } | null = null;

  constructor(private readonly onMoved: (pos: OverlayPos) => void) {}

  show(cfg: FloatingOverlayConfig): void {
    this.cfg = cfg;
    if (!this.win || this.win.isDestroyed()) this.create();
    this.apply();
    this.win!.showInactive();
  }

  update(cfg: FloatingOverlayConfig): void {
    if (!this.cfg) return;
    // A window the user closed (Alt+F4) is recreated on the next update.
    if (!this.win || this.win.isDestroyed()) { this.show(cfg); return; }
    this.cfg = cfg;
    // The user is mid-drag: the renderer's pos is stale, do not yank the window back.
    if (!this.dragging) this.apply();
  }

  /** Destroys the window so its camera stream is released (no webcam LED left on). */
  hide(): void {
    this.cfg = null;
    this.dispose();
  }

  dispose(): void {
    this.imageCache = null;
    const w = this.win;
    this.win = null;
    this.dragging = false;
    if (w && !w.isDestroyed()) w.destroy();
  }

  private create(): void {
    const win = new BrowserWindow({
      width: 240, height: 240, frame: false, transparent: true, resizable: false, hasShadow: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, fullscreenable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    // will-move / moved fire only for manual drags, never for setBounds.
    win.on('will-move', () => { this.dragging = true; });
    win.on('moved', () => { this.dragging = false; });
    win.on('move', () => {
      if (!this.cfg || win.isDestroyed()) return;
      const b = win.getBounds();
      const unchanged = b.x === this.lastOrigin.x && b.y === this.lastOrigin.y;
      if (unchanged || (!this.dragging && Date.now() < this.applyingUntil)) return;
      const area = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).bounds;
      this.area = area;
      this.lastOrigin = { x: b.x, y: b.y };
      this.onMoved(windowOriginToPos({ x: b.x, y: b.y }, area, b));
    });
    win.on('closed', () => { if (this.win === win) this.win = null; });
    win.webContents.on('did-finish-load', () => { this.bgKey = ''; void this.pushBackground(); });
    this.win = win;
    this.lastOrigin = { x: NaN, y: NaN };
    const q = new URLSearchParams({ shape: this.cfg!.shape });
    if (this.cfg!.cameraDeviceId) q.set('cam', this.cfg!.cameraDeviceId);
    void win.loadURL(`${ORIGIN}/renderer/overlay.html?${q}`);
  }

  /** Sends the background choice (and the image bytes, only when the path changed) to the bubble page. */
  private async pushBackground(): Promise<void> {
    const win = this.win;
    const bg = this.cfg?.background;
    if (!win || win.isDestroyed() || !bg) return;
    const key = JSON.stringify(bg);
    if (key === this.bgKey) return;
    this.bgKey = key;
    const image = bg.mode === 'image' && bg.imagePath ? await this.loadImage(bg.imagePath) : null;
    if (this.win !== win || win.isDestroyed() || this.bgKey !== key) return;
    const spec = { mode: bg.mode, color: bg.color, blurRadius: bg.blurRadius };
    const js = `window.__setBackground&&window.__setBackground(${JSON.stringify(spec)},${JSON.stringify(image)})`;
    void win.webContents.executeJavaScript(js).catch(() => undefined);
  }

  private async loadImage(p: string): Promise<{ mime: string; b64: string } | null> {
    if (this.imageCache?.path === p) return this.imageCache.payload;
    let payload: { mime: string; b64: string } | null = null;
    try {
      const mime = IMAGE_MIME[path.extname(p).toLowerCase()];
      const st = await fsp.stat(p);
      if (mime && st.isFile() && st.size <= MAX_IMAGE_BYTES) {
        payload = { mime, b64: (await fsp.readFile(p)).toString('base64') };
      }
    } catch { payload = null; }
    this.imageCache = { path: p, payload };
    return payload;
  }

  private apply(): void {
    const win = this.win;
    const cfg = this.cfg;
    if (!win || win.isDestroyed() || !cfg) return;
    // Values are validated upstream (enum shape, #rrggbb color, numeric width); JSON.stringify keeps them literal.
    const b = cfg.border;
    const js = `(()=>{const d=document.body;d.dataset.shape=${JSON.stringify(cfg.shape)};`
      + `d.dataset.mirror=${JSON.stringify(cfg.mirror ? 'on' : 'off')};`
      + `d.dataset.border=${JSON.stringify(b.enabled ? 'on' : 'off')};`
      + `d.style.setProperty('--bw',${JSON.stringify(`${b.width}px`)});`
      + `d.style.setProperty('--bc',${JSON.stringify(b.color)})})()`;
    void win.webContents.executeJavaScript(js).catch(() => undefined);
    void this.pushBackground();
    const area = this.area ?? screen.getPrimaryDisplay().bounds;
    // Same layout the compositor uses (margin included), in display DIPs.
    const r = overlayRectFor(area, {
      corner: cfg.corner, sizePercent: cfg.sizePercent, marginPercent: DEFAULT_SETTINGS.overlay.marginPercent,
      shape: cfg.shape, pos: cfg.pos,
    });
    const next = { x: area.x + r.x, y: area.y + r.y, width: r.width, height: r.height };
    const cur = win.getBounds();
    if (cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height) return;
    this.lastOrigin = { x: next.x, y: next.y };
    this.applyingUntil = Date.now() + 150;
    win.setBounds(next);
  }
}
