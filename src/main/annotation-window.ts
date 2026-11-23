import { BrowserWindow, screen, type WebContents } from 'electron';
import * as path from 'node:path';
import { modeAfterEscape, modeAfterHotkey, type AnnotationMode } from '../shared/annotation';
import { barLayout, sanitizeBarState, type BarState } from '../shared/annotation-bar';
import { overlaySkipReason, sanitizeStrokeUpdate, type AnnotationDisplay, type AnnotationEvent } from '../shared/annotation-strokes';
import type { Rect } from '../shared/overlay-layout';
import { overPassThrough } from '../shared/pass-through';
import { ANNOTATION_CONTROL_VIEW_EVENT, parseControlHudCommand, type ControlHudCommand, type ControlHudView } from '../shared/control-hud';
import { debugLog } from './debug-log';

const ORIGIN = 'app://local';
/** How long a display description is reused: stroke messages arrive ~25 times a second, getSources is expensive. */
const DESCRIBE_TTL_MS = 500;
/** How often the cursor is tested against the pass-through rects (the control toolbar) while drawing. */
const PASS_THROUGH_POLL_MS = 40;
const PASS_THROUGH_PAD = 2;

/** Where the strokes go (the recorder renderer) and how to describe the overlay's display. */
export interface AnnotationHooks {
  emit: (ev: AnnotationEvent) => void;
  /** Overlay display id plus whether it is the captured display (decided here in main, not in the renderer). */
  describeDisplay: (bounds: Rect) => Promise<Omit<AnnotationDisplay, 'widthDip'>>;
  /** The draw bar's screen rectangle (DIP) with its display, or null when the bar is gone / click-through. */
  barRect?: (bar: { bar: Rect; area: Rect } | null) => void;
  /** Screen rectangles (DIP) of other recorder windows (the control toolbar) that must keep receiving clicks while drawing. */
  passThroughRects?: () => (Rect | null)[];
  /** A validated recording command clicked in the controls rendered inside the overlay (same path as the toolbar's). */
  onControl?: (cmd: ControlHudCommand) => void;
  /** True while the overlay takes input (draw mode): the standalone toolbar is hidden then, its controls live in the overlay. */
  onDrawingChange?: (drawing: boolean) => void;
}

/**
 * Transparent always-on-top draw overlay over one display. It is hidden from screen capture
 * (setContentProtection), like the camera bubble: OS capture of such a window is unreliable, and this way the
 * toolbar never shows up in the video. The strokes reach the recording instead as data: each stroke message (sent while
 * drawing and at pen-up, and Clear / closing the overlay) is validated here and forwarded to the recorder, whose
 * compositor draws them.
 * In draw mode it takes the mouse; Esc (handled here) switches to click-through with the strokes left visible.
 */
export class AnnotationOverlay {
  private win: BrowserWindow | null = null;
  private mode: AnnotationMode = 'closed';
  private bounds: Rect | null = null;
  /** Strokes are described asynchronously; chaining keeps them in drawing order. */
  private queue: Promise<void> = Promise.resolve();
  /** The last "not recorded" notice shown on the overlay (null = none), so it is only sent when it changes. */
  private notice: string | null = null;
  /** Bumped by Clear / close: queued stroke messages from before it are dropped so they cannot reappear. */
  private generation = 0;
  /** Last bar state and its display, kept so the bar can be hidden in the recording without asking the page. */
  private lastBar: { bar: BarState; display: AnnotationDisplay } | null = null;
  private passTimer: ReturnType<typeof setInterval> | null = null;
  private passing = false;
  private controlView: ControlHudView | null = null;
  private drawing = false;
  private lastPassLog = { at: 0, key: '' };
  private described: { at: number; value: Omit<AnnotationDisplay, 'widthDip'> } | null = null;

  constructor(
    private readonly displayBounds: () => Promise<Rect>,
    private readonly closeHotkey: () => string,
    private readonly hooks?: AnnotationHooks,
  ) {}

  /** A stroke message from the overlay page. Dropped unless it comes from the overlay window itself and is valid. */
  handleStroke(sender: WebContents, raw: unknown): void {
    const bounds = this.bounds;
    const hooks = this.hooks;
    if (!this.isOwnSender(sender)) { console.warn('[annotation] stroke rejected: sender is not the overlay window'); return; }
    if (!bounds || !hooks) { console.warn('[annotation] stroke rejected: no overlay bounds / hooks'); return; }
    const stroke = sanitizeStrokeUpdate(raw);
    if (!stroke) { console.warn('[annotation] stroke rejected: invalid payload'); return; }
    const gen = this.generation;
    this.queue = this.queue.then(async () => {
      const d = await this.describe(bounds);
      if (gen !== this.generation) return; // cleared or closed while it waited
      const display = { ...d, widthDip: bounds.width };
      hooks.emit({ t: 'stroke', stroke, display });
      this.showNotice(overlaySkipReason(display));
    }).catch((e) => { console.warn('[annotation] stroke dropped:', e instanceof Error ? e.message : e); });
  }

  /**
   * The toolbar state from the overlay page. Same checks and ordering as strokes; `visible` is decided here from the
   * mode (the page is not trusted with it), so the bar leaves the recording whenever the overlay is not taking input.
   */
  handleBar(sender: WebContents, raw: unknown): void {
    const bounds = this.bounds;
    const hooks = this.hooks;
    if (!this.isOwnSender(sender)) { console.warn('[annotation] bar rejected: sender is not the overlay window'); return; }
    if (!bounds || !hooks) { console.warn('[annotation] bar rejected: no overlay bounds / hooks'); return; }
    const parsed = sanitizeBarState(raw);
    if (!parsed) { console.warn('[annotation] bar rejected: invalid payload'); return; }
    const gen = this.generation;
    this.queue = this.queue.then(async () => {
      const d = await this.describe(bounds);
      if (gen !== this.generation) return;
      const display = { ...d, widthDip: bounds.width };
      const bar = { ...parsed, visible: this.mode === 'draw' };
      this.lastBar = { bar, display };
      hooks.emit({ t: 'bar', bar, display });
      if (bar.visible) {
        const L = barLayout();
        hooks.barRect?.({ bar: { x: bounds.x + bar.x * bounds.width, y: bounds.y + bar.y * bounds.height, width: L.width, height: L.height }, area: bounds });
      }
      this.showNotice(overlaySkipReason(display));
    }).catch((e) => { console.warn('[annotation] bar dropped:', e instanceof Error ? e.message : e); });
  }

  /** Take the bar out of the recording (click-through): the strokes stay, the toolbar is not on screen either. */
  private hideBar(): void {
    const last = this.lastBar;
    const hooks = this.hooks;
    if (!last || !hooks) return;
    const gen = this.generation;
    const hidden = { bar: { ...last.bar, visible: false }, display: last.display };
    this.lastBar = hidden;
    hooks.barRect?.(null);
    this.queue = this.queue.then(() => { if (gen === this.generation) hooks.emit({ t: 'bar', ...hidden }); });
  }

  /** Display description, reused for a short time so a stream of stroke messages does not hammer desktopCapturer. */
  private async describe(bounds: Rect): Promise<Omit<AnnotationDisplay, 'widthDip'>> {
    const hit = this.described;
    if (hit && Date.now() - hit.at < DESCRIBE_TTL_MS) return hit.value;
    const value = await this.hooks!.describeDisplay(bounds);
    this.described = { at: Date.now(), value };
    return value;
  }

  /** Tell the user on the overlay itself when strokes cannot reach the recording (also logged once per change). */
  private showNotice(reason: string | null): void {
    if (reason === this.notice) return;
    this.notice = reason;
    if (reason) console.warn(`[annotation] ${reason}`);
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    void win.webContents.executeJavaScript(`window.setAnnotationNotice?.(${JSON.stringify(reason)})`).catch(() => undefined);
  }

  /** A click on the in-overlay recording controls. Same checks as the toolbar: own sender, whitelist, then the shared relay. */
  handleControl(sender: WebContents, raw: unknown): void {
    debugLog('[control-hud] overlay control received', JSON.stringify(raw), 'from webContents', sender?.id, 'overlay', this.win && !this.win.isDestroyed() ? this.win.webContents.id : 'none', 'mode', this.mode);
    if (!this.isOwnSender(sender)) { debugLog('[control-hud] overlay control dropped: sender is not the overlay window'); return; }
    const cmd = parseControlHudCommand(raw);
    if (!cmd) { debugLog('[control-hud] overlay control dropped: not whitelisted'); return; }
    if (!this.hooks?.onControl) { debugLog('[control-hud] overlay control dropped: no relay hook'); return; }
    debugLog('[control-hud] relaying overlay command to main renderer:', cmd);
    this.hooks.onControl(cmd);
  }

  /** State of the recording controls (null = no recording): remembered and pushed to the overlay page. */
  setControlView(v: ControlHudView | null): void {
    this.controlView = v;
    this.pushControlView();
  }

  private pushControlView(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
    try { win.webContents.send(ANNOTATION_CONTROL_VIEW_EVENT, this.controlView); } catch { /* page gone */ }
  }

  private setDrawing(on: boolean): void {
    if (this.drawing === on) return;
    this.drawing = on;
    debugLog('[control-hud] overlay drawing', on, '-> standalone toolbar', on ? 'hidden' : 'shown');
    this.hooks?.onDrawingChange?.(on);
  }

  /** The overlay's Clear button. */
  handleClear(sender: WebContents): void {
    if (!this.isOwnSender(sender)) return;
    this.generation++;
    this.hooks?.emit({ t: 'clear' });
  }

  private isOwnSender(sender: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && sender === this.win.webContents;
  }

  async toggle(): Promise<void> {
    const next = modeAfterHotkey(this.mode);
    if (next === 'closed') { this.dispose(); return; }
    if (!this.win || this.win.isDestroyed()) {
      const bounds = await this.displayBounds();
      // Another toggle may have run while the display was looked up.
      if (this.win && !this.win.isDestroyed()) return;
      this.create(bounds);
      return; // shown once the page is ready
    }
    this.setMode('draw');
  }

  dispose(): void {
    this.setDrawing(false);
    this.stopPassThrough();
    const w = this.win;
    this.win = null;
    this.mode = 'closed';
    this.notice = null;
    this.generation++;
    this.described = null;
    this.lastBar = null;
    this.hooks?.barRect?.(null);
    if (w && !w.isDestroyed()) w.destroy();
    this.hooks?.emit({ t: 'clear' });
  }

  private create(bounds: Rect): void {
    const win = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/annotate-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    this.logGeometry('created', win, bounds);
    win.webContents.on('did-finish-load', () => { this.pushControlView(); });
    (win.webContents as NodeJS.EventEmitter).on('console-message', (...a: unknown[]) => {
      const msg = String((a[0] as { message?: unknown } | undefined)?.message ?? a[2] ?? '');
      if (msg.startsWith('[control-hud]')) debugLog(msg);
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && this.mode === 'draw') {
        e.preventDefault();
        this.setMode(modeAfterEscape(this.mode));
      }
    });
    win.on('closed', () => {
      if (this.win === win) { this.setDrawing(false); this.stopPassThrough(); this.win = null; this.mode = 'closed'; this.notice = null; this.generation++; this.described = null; this.lastBar = null; this.hooks?.barRect?.(null); this.hooks?.emit({ t: 'clear' }); }
    });
    win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.setBounds(bounds); this.setMode('draw'); } });
    this.win = win;
    this.bounds = bounds;
    this.described = null;
    this.mode = 'draw';
    const q = new URLSearchParams({ hk: this.closeHotkey() });
    void win.loadURL(`${ORIGIN}/renderer/annotate.html?${q}`);
  }

  private setMode(mode: AnnotationMode): void {
    const win = this.win;
    if (!win || win.isDestroyed() || mode === 'closed') return;
    this.mode = mode;
    const draw = mode === 'draw';
    win.setIgnoreMouseEvents(!draw);
    debugLog('[control-hud] overlay mode', mode, 'setIgnoreMouseEvents', !draw);
    this.passing = !draw;
    this.setDrawing(draw);
    if (draw) this.pushControlView();
    if (draw) this.startPassThrough(win); else this.stopPassThrough();
    win.setFocusable(draw);
    void win.webContents.executeJavaScript(`document.body.dataset.mode=${JSON.stringify(mode)}`).catch(() => undefined);
    if (draw) void win.webContents.executeJavaScript('window.resendBar?.()').catch(() => undefined);
    else this.hideBar();
    if (!win.isVisible()) { if (draw) win.show(); else win.showInactive(); }
    if (draw) win.focus();
    this.logGeometry('mode ' + mode, win, this.bounds);
  }

  /** Overlay bounds, visibility and display scale: a DIP / physical mismatch is a hit-testing suspect on scaled Windows. */
  private logGeometry(tag: string, win: BrowserWindow, wanted: Rect | null): void {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    debugLog('[control-hud] overlay', tag, 'bounds', JSON.stringify(b), 'wanted', JSON.stringify(wanted), 'visible', win.isVisible(), 'alwaysOnTop', win.isAlwaysOnTop(), 'display', d.id, JSON.stringify(d.bounds), 'scaleFactor', d.scaleFactor);
  }

  /**
   * The overlay covers the whole display and captures every click in draw mode, which also covers the control toolbar
   * (a separate always-on-top window). While the cursor is over the toolbar the overlay turns click-through, so the
   * click goes to whatever is under it (the toolbar); everywhere else it still draws. Polled: with plain
   * setIgnoreMouseEvents(true) the page would stop seeing mouse moves, so it could not switch back by itself.
   */
  private startPassThrough(win: BrowserWindow): void {
    this.stopPassThrough();
    if (!this.hooks?.passThroughRects) return;
    this.passTimer = setInterval(() => {
      if (this.win !== win || win.isDestroyed() || this.mode !== 'draw') return;
      const cursor = screen.getCursorScreenPoint();
      const rects = this.hooks?.passThroughRects?.() ?? [];
      const over = overPassThrough(cursor, rects, PASS_THROUGH_PAD);
      this.logPoll(cursor, rects, over);
      if (over === this.passing) return;
      this.passing = over;
      win.setIgnoreMouseEvents(over);
      debugLog(`[control-hud] annotation overlay setIgnoreMouseEvents(${over}) - ${over ? 'click-through over the toolbar' : 'captures the mouse again'}`);
    }, PASS_THROUGH_POLL_MS);
  }

  /** Cursor vs toolbar rect, only while a rect exists, only on change, at most twice a second. Both in DIP (the physical cursor is logged to spot a scale mismatch). */
  private logPoll(cursor: { x: number; y: number }, rects: (Rect | null)[], over: boolean): void {
    if (!rects.some((r) => !!r)) return;
    const key = JSON.stringify([cursor, rects, over]);
    const now = Date.now();
    if (key === this.lastPassLog.key || now - this.lastPassLog.at < 500) return;
    this.lastPassLog = { at: now, key };
    let physical: unknown = null;
    try { physical = screen.dipToScreenPoint(cursor); } catch { /* not available off Windows */ }
    debugLog('[control-hud] poll cursorDip', JSON.stringify(cursor), 'cursorPhysical', JSON.stringify(physical), 'toolbarRectDip', JSON.stringify(rects), 'over', over);
  }

  private stopPassThrough(): void {
    if (this.passTimer) clearInterval(this.passTimer);
    this.passTimer = null;
  }
}
