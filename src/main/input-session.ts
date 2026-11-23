import type { DisplayInfo, InputEvent, InputRequest, InputStartResult, MouseButtonName } from '../shared/ipc';
import { formatKeyEvent } from '../shared/key-labels';

/** The slice of uiohook-napi's `uIOhook` we use (lets tests pass a fake). */
export interface HookLike {
  on(event: string, fn: (e: never) => void): unknown;
  removeListener(event: string, fn: (e: never) => void): unknown;
  start(): void;
  stop(): void;
}
export interface HookLoad { hook: HookLike | null; error: string | null }

export interface InputSessionDeps {
  /** Loads the native hook lazily; failures are reported, never thrown. */
  loadHook: () => HookLoad;
  /** Cursor position in screen DIPs. */
  cursorPoint: () => { x: number; y: number };
  emit: (e: InputEvent) => void;
  /** Display shown by the selected capture source, null when unknown. */
  resolveDisplay: () => Promise<DisplayInfo | null>;
  /** Best guess for a screen source whose display is unknown (manual zoom only). */
  fallbackDisplay?: () => DisplayInfo | null;
  pollMs?: number;
}

export interface InputSession {
  start(req: InputRequest): Promise<InputStartResult>;
  /** Idempotent: removes listeners, stops polling and stops the native hook. */
  stop(): void;
  active(): boolean;
}

const BUTTON_NAMES: Record<number, MouseButtonName> = { 1: 'left', 2: 'right', 3: 'middle' };
interface MouseLike { button?: unknown }
interface KeyLike { keycode: number; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

/**
 * The only place that listens to global input. It runs from the start of a recording to its end (the
 * caller stops it) and forwards cursor positions, click positions and key *labels*; key events are
 * never logged or stored here.
 */
export function createInputSession(deps: InputSessionDeps): InputSession {
  let gen = 0;
  let live = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let hook: HookLike | null = null;
  let hookRunning = false;
  let onDown: ((e: never) => void) | null = null;
  let onKey: ((e: never) => void) | null = null;

  const stop = () => {
    gen++;
    live = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (hook) {
      if (onDown) hook.removeListener('mousedown', onDown);
      if (onKey) hook.removeListener('keydown', onKey);
      if (hookRunning) { try { hook.stop(); } catch { /* already stopped */ } }
    }
    hook = null; hookRunning = false; onDown = null; onKey = null;
  };

  const startHook = (req: InputRequest): string => {
    const { hook: h, error } = deps.loadHook();
    if (!h) return `Mouse/keyboard hook unavailable (${error ?? 'unknown error'}): click ripples, auto-zoom and keystrokes are off.`;
    const downFn = (e: MouseLike) => {
      const button = BUTTON_NAMES[e.button as number];
      if (!button) return;
      try { deps.emit({ t: 'click', ...deps.cursorPoint(), button }); } catch { /* sender gone */ }
    };
    const keyFn = (e: KeyLike) => {
      const label = formatKeyEvent({ keycode: e.keycode, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
      if (label) { try { deps.emit({ t: 'key', text: label.text, combo: label.combo }); } catch { /* sender gone */ } }
    };
    if (req.clicks) { onDown = downFn as (e: never) => void; h.on('mousedown', onDown); }
    if (req.keys) { onKey = keyFn as (e: never) => void; h.on('keydown', onKey); }
    hook = h;
    try {
      h.start();
      hookRunning = true;
      return '';
    } catch (e) {
      if (onDown) h.removeListener('mousedown', onDown);
      if (onKey) h.removeListener('keydown', onKey);
      hook = null; onDown = null; onKey = null;
      return `Mouse/keyboard hook failed to start (${e instanceof Error ? e.message : String(e)}): click ripples, auto-zoom and keystrokes are off.`;
    }
  };

  return {
    async start(req) {
      stop();
      const mine = ++gen;
      let display: DisplayInfo | null = null;
      try { display = await deps.resolveDisplay(); } catch { /* unknown display */ }
      if (mine !== gen) return { hookAvailable: false, display: null, message: 'Input tracking was cancelled.' };
      live = true;
      let approximate = false;
      if (!display && req.cursor && deps.fallbackDisplay) {
        try { display = deps.fallbackDisplay(); approximate = display !== null; } catch { /* no guess */ }
      }
      const notes: string[] = [];
      const needsDisplay = req.cursor || req.clicks;
      if (needsDisplay && (!display || approximate)) {
        notes.push('Cursor effects and auto-zoom are skipped: the captured source is not a screen with a known position.');
      }
      if (req.cursor && display) {
        let last = { x: NaN, y: NaN };
        timer = setInterval(() => {
          const p = deps.cursorPoint();
          if (p.x === last.x && p.y === last.y) return;
          last = { x: p.x, y: p.y };
          try { deps.emit({ t: 'cursor', x: p.x, y: p.y }); } catch { /* sender gone */ }
        }, deps.pollMs ?? 16);
      }
      let hookAvailable = true;
      // Clicks are only useful with a known display: do not even hook the mouse without one.
      const hookReq = { ...req, clicks: req.clicks && display !== null && !approximate };
      if (hookReq.clicks || hookReq.keys) {
        const err = startHook(hookReq);
        if (err) { notes.push(err); hookAvailable = false; }
      }
      return { hookAvailable, display, ...(approximate ? { approximate } : {}), message: notes.join(' ') };
    },
    stop,
    active: () => live,
  };
}
