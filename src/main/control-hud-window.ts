import * as path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { debugLog } from './debug-log';
import type { WebContents } from 'electron';
import type { Rect } from '../shared/overlay-layout';
import {
  CONTROL_HUD_VIEW_EVENT, pickControlHudAnchor, controlHudDockedRect, controlHudRect, controlHudView, parseControlHudCommand, sameControlHudState,
  type ControlHudAnchor, type ControlHudCommand, type ControlHudState, type ControlHudView,
} from '../shared/control-hud';

const ORIGIN = 'app://local';
const SIZE = { width: 330, height: 44 };
const MARGIN = 16;
const DOCK_GAP = 8;

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const sameAnchor = (a: ControlHudAnchor | null, b: ControlHudAnchor | null): boolean =>
  !a || !b ? a === b : sameRect(a.bar, b.bar) && sameRect(a.area, b.area);
const KEEP_ON_TOP_MS = 1000;

/**
 * Always-on-top mini toolbar (pause/resume, cam-only <-> cam + screen, stop) shown over the desktop while recording.
 * Clickable but not focusable (showInactive keeps focus on the app being recorded), hidden from screen capture so it
 * never ends up in the video. Its page only gets a tiny preload: validated view in, whitelisted commands out.
 */
export class ControlHud {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private state: ControlHudState | null = null;
  private placing = false;
  private keepOnTop: ReturnType<typeof setInterval> | null = null;
  /** Annotation bar (priority) and mobile window rectangles; the toolbar docks to one of them in mobile output only. */
  private barAnchor: ControlHudAnchor | null = null;
  private mobileAnchor: ControlHudAnchor | null = null;
  private mobileOutput: () => boolean = () => false;
  private lastArea: Rect | null = null;
  /** True while the annotation overlay shows the same controls itself: the standalone window stays hidden. */
  private suppressed = false;
  private viewListener: ((v: ControlHudView | null) => void) | null = null;

  /** `displayBounds`: display being recorded; `onCommand`: runs a validated command in the main renderer. */
  constructor(private readonly displayBounds: () => Promise<Rect>, private readonly onCommand: (c: ControlHudCommand) => void) {}

  /** null = not recording (hide). */
  update(s: ControlHudState | null): void {
    if (sameControlHudState(this.state, s)) return;
    this.state = s;
    debugLog('[control-hud] state', JSON.stringify(s), 'suppressed', this.suppressed);
    this.viewListener?.(s ? controlHudView(s) : null);
    this.sync();
  }

  /** Mirror of the displayed state for the in-overlay controls (called on every change, null = not recording). */
  setViewListener(fn: ((v: ControlHudView | null) => void) | null): void {
    this.viewListener = fn;
    if (fn) fn(this.state ? controlHudView(this.state) : null);
  }

  /** Hide the toolbar window (annotation overlay shows the controls) / bring it back. */
  setSuppressed(on: boolean): void {
    if (this.suppressed === on) return;
    this.suppressed = on;
    debugLog('[control-hud] toolbar window', on ? 'suppressed (controls are inside the annotation overlay)' : 'unsuppressed');
    this.sync();
  }

  handleCommand(sender: WebContents, raw: unknown): void {
    const win = this.win;
    debugLog('[control-hud] main received command', JSON.stringify(raw), 'from webContents', sender?.id, 'hud', win && !win.isDestroyed() ? win.webContents.id : 'none');
    if (!win || win.isDestroyed()) { debugLog('[control-hud] command dropped: no toolbar window'); return; }
    // Compare by id as well as identity: the toolbar's own webContents is the only one allowed.
    if (sender !== win.webContents && sender?.id !== win.webContents.id) { debugLog('[control-hud] command dropped: sender is not the toolbar'); return; }
    const cmd = parseControlHudCommand(raw);
    if (!cmd) { debugLog('[control-hud] command dropped: not whitelisted'); return; }
    debugLog('[control-hud] relaying to main renderer:', cmd);
    this.onCommand(cmd);
  }

  /** The toolbar's screen rectangle (DIP) while it is on screen, else null. */
  getRect(): Rect | null {
    const win = this.win;
    return win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null;
  }

  /** Annotation bar + its display (mobile output only), or null: dock next to the bar, or back to top-centre. */
  setAnchor(a: ControlHudAnchor | null): void {
    if (sameAnchor(this.barAnchor, a)) return;
    this.barAnchor = a;
    this.replace();
  }

  /** The mobile browser window (screen DIP) and its display, or null when it is closed / minimized / hidden. */
  setMobileFrame(a: ControlHudAnchor | null): void {
    if (sameAnchor(this.mobileAnchor, a)) return;
    this.mobileAnchor = a;
    debugLog('[control-hud] mobile frame', JSON.stringify(a));
    this.replace();
  }

  /** Whether the output format is 'mobile' (asked each time the toolbar is placed). */
  setMobileOutput(fn: () => boolean): void { this.mobileOutput = fn; }

  private replace(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible() || !this.lastArea) return;
    this.place(win, this.lastArea);
    this.raise(win);
  }

  private place(win: BrowserWindow, area: Rect): void {
    const anchor = pickControlHudAnchor(this.barAnchor, this.mobileAnchor, this.mobileOutput());
    const next = anchor ? controlHudDockedRect(anchor, SIZE, DOCK_GAP) : controlHudRect(area, SIZE, MARGIN);
    const b = win.getBounds();
    if (b.x !== next.x || b.y !== next.y || b.width !== next.width || b.height !== next.height) win.setBounds(next);
  }

  dispose(): void {
    this.state = null;
    this.destroy();
  }

  private sync(): void {
    if (!this.state) { this.destroy(); return; }
    if (this.suppressed) {
      this.stopKeepOnTop();
      if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
      return;
    }
    if (!this.win || this.win.isDestroyed()) this.create();
    const win = this.win!;
    if (!this.loaded) return; // did-finish-load calls sync again
    this.push();
    if (!win.isVisible() && !this.placing) void this.showOn(win);
    else if (win.isVisible()) this.raise(win);
  }

  /**
   * All recorder overlays share the 'screen-saver' band and the newest-shown one is on top. The full-display capture
   * frame (and zoom HUD) are shown AFTER the toolbar when a live switch starts the screen session, so they end up
   * above it; keep the toolbar topmost. moveTop never activates the window (focusable:false), so no focus is stolen.
   */
  private raise(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    win.setIgnoreMouseEvents(false);
    win.setAlwaysOnTop(true, 'screen-saver'); // re-assert the topmost flag, then go above the newest overlays
    win.moveTop();
  }

  private startKeepOnTop(win: BrowserWindow): void {
    this.stopKeepOnTop();
    this.keepOnTop = setInterval(() => {
      if (this.win !== win || win.isDestroyed() || !win.isVisible()) return;
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
    }, KEEP_ON_TOP_MS);
  }

  private stopKeepOnTop(): void {
    if (this.keepOnTop) clearInterval(this.keepOnTop);
    this.keepOnTop = null;
  }

  /** Display lookup is async: position, then show unless the toolbar was hidden/replaced meanwhile. */
  private async showOn(win: BrowserWindow): Promise<void> {
    this.placing = true;
    let area: Rect | null = null;
    try { area = await this.displayBounds(); } catch { /* fall through */ } finally { this.placing = false; }
    if (!area || this.win !== win || win.isDestroyed() || !this.state || this.suppressed) return;
    this.lastArea = area;
    this.place(win, area);
    win.showInactive();
    this.raise(win);
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    debugLog('[control-hud] shown at', JSON.stringify(b), 'recorded display', JSON.stringify(area), 'visible', win.isVisible(), 'alwaysOnTop', win.isAlwaysOnTop(), 'matching display', d.id, JSON.stringify(d.bounds), 'scaleFactor', d.scaleFactor);
    this.startKeepOnTop(win);
  }

  private create(): void {
    const win = new BrowserWindow({
      width: SIZE.width, height: SIZE.height, frame: false, transparent: true, resizable: false, movable: false,
      // Deliberately focusable (no focusable:false): a non-activatable transparent window is the prime suspect for a
      // toolbar that renders but gets no clicks on Windows. showInactive() still avoids stealing focus on show.
      hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, fullscreenable: false, acceptFirstMouse: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/control-hud-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true); // not part of the recording
    debugLog('[control-hud] window created', JSON.stringify(win.getBounds()), 'alwaysOnTop', win.isAlwaysOnTop());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('preload-error', (_e, p, err) => debugLog('[control-hud] preload failed:', p, err?.message ?? err));
    win.webContents.on('did-fail-load', (_e, code, desc, url) => debugLog('[control-hud] page failed to load:', code, desc, url));
    // Page-side logs (button clicks) show up in the main process console.
    (win.webContents as NodeJS.EventEmitter).on('console-message', (...a: unknown[]) => {
      const msg = String((a[0] as { message?: unknown } | undefined)?.message ?? a[2] ?? '');
      if (msg.startsWith('[control-hud]')) debugLog(msg);
    });
    win.webContents.on('did-finish-load', () => {
      if (this.win !== win || win.isDestroyed()) return;
      debugLog('[control-hud] page loaded');
      this.loaded = true;
      this.sync();
    });
    win.on('closed', () => { if (this.win === win) { this.win = null; this.loaded = false; } });
    this.win = win;
    this.loaded = false;
    void win.loadURL(`${ORIGIN}/renderer/control-hud.html`);
  }

  private destroy(): void {
    const w = this.win;
    this.stopKeepOnTop();
    this.win = null;
    this.loaded = false;
    if (w && !w.isDestroyed()) w.destroy();
  }

  private push(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.loaded || !this.state) return;
    win.webContents.send(CONTROL_HUD_VIEW_EVENT, controlHudView(this.state));
  }
}
