import type { InputRequest, RecorderApi, Settings } from '../shared/ipc';
import { parseInputEvent } from '../shared/input-events';
import { sanitizeDisplayInfo } from '../shared/cursor-map';
import type { Compositor } from './compositor';
import { createEffects } from './effects';
import type { ZoomCommand } from '../shared/zoom';
import { deriveZoomHud, sameZoomHud, type ZoomHudUpdate } from '../shared/zoom-hud';

const HUD_POLL_MS = 100;

export interface InputEffects {
  /** Begin watching input for the recording that just started (no-op when no effect applies). */
  start(): Promise<void>;
  /** End of recording: stop the main-process hook and drop all effect state. */
  stop(): void;
  /** Hotkey zoom; returns the status text, or null when it does not apply (not recording / not a screen source). */
  zoom(cmd: ZoomCommand): string | null;
}

/** The request for screen recordings (cursor is always on for manual zoom); null for other sources. */
export function inputRequestFor(s: Settings): InputRequest | null {
  if (s.captureMode !== 'screen') return null;
  const e = s.effects;
  // Cursor events are always needed: manual zoom hotkeys follow the cursor even with every effect off.
  const req = { cursor: true, clicks: e.clickRipples || e.autoZoom > 1, keys: e.keystrokes };
  return req;
}

/**
 * Wires the main-process input feed to the compositor's effects layer for the length of one recording.
 * Nothing listens while idle: the hook is started by start() and stopped by stop().
 */
export function createInputEffects(
  api: RecorderApi, comp: Compositor, settings: Settings, status: (t: string) => void,
): InputEffects {
  const fx = createEffects(() => settings.effects);
  let gen = 0;
  let unsubscribe: (() => void) | null = null;
  let ready = false;
  let hasDisplay = false;
  let hudTimer: ReturnType<typeof setInterval> | null = null;
  let lastHud: Pick<ZoomHudUpdate, 'factor' | 'mode'> | null = null;

  /** The zoom as the HUD shows it: the real smoothed factor, so easing and click auto-zoom show up too. */
  function hudState(): Pick<ZoomHudUpdate, 'factor' | 'mode'> {
    const factor = fx.zoomFactor();
    return { factor, mode: deriveZoomHud(factor, fx.manualLevel(), settings.effects.autoZoom > 1) };
  }
  /** Sends on change only (the poll runs at ~10 Hz); a flash always goes through. Never throws. */
  function sendHud(flash: boolean, state = hudState()): void {
    if (!settings.effects.zoomHud) { lastHud = null; return; }
    if (!flash && sameZoomHud(lastHud, state)) return;
    lastHud = state;
    try { void api.zoomHudUpdate({ ...state, flash }).catch(() => undefined); } catch { /* HUD is optional */ }
  }
  function stopHudPoll(): void {
    if (hudTimer) clearInterval(hudTimer);
    hudTimer = null;
    lastHud = null;
  }

  function stop(): void {
    gen++;
    unsubscribe?.();
    unsubscribe = null;
    ready = false; hasDisplay = false;
    stopHudPoll();
    comp.setEffects(null);
    fx.reset();
    void api.inputStop().catch(() => undefined);
  }
  window.addEventListener('pagehide', stop);

  return {
    stop,
    zoom(cmd) {
      // Even when the zoom cannot apply the HUD flashes, so the key press is visibly received.
      const unavailable = (msg: string): string => { sendHud(true, { factor: 1, mode: 'none' }); return msg; };
      if (settings.captureMode !== 'screen') return unavailable('Zoom unavailable: only screen recordings can be zoomed (not a camera).');
      if (!unsubscribe) return unavailable('Zoom unavailable: start a screen recording first.');
      if (!ready) return unavailable('Zoom unavailable: input tracking is still starting.');
      if (!hasDisplay) return unavailable('Zoom unavailable: the captured screen is unknown (window source?).');
      const level = fx.zoomBy(cmd);
      sendHud(true, { factor: Math.max(fx.zoomFactor(), 1), mode: deriveZoomHud(fx.zoomFactor(), level, settings.effects.autoZoom > 1) });
      return level > 1 ? `Zoom ${level.toFixed(1)}x` : 'Zoom reset';
    },
    async start() {
      const req = inputRequestFor(settings);
      if (!req) return;
      const mine = ++gen;
      unsubscribe?.();
      unsubscribe = api.onInput((raw) => {
        const ev = parseInputEvent(raw);
        if (ev) fx.push(ev);
      });
      try {
        const res = await api.inputStart(req);
        if (mine !== gen) return; // recording already ended
        const d = sanitizeDisplayInfo(res.display);
        fx.setDisplay(d, res.approximate === true);
        hasDisplay = d !== null;
        ready = true;
        comp.setEffects(fx);
        stopHudPoll();
        hudTimer = setInterval(() => sendHud(false), HUD_POLL_MS);
        if (res.message) status(`Recording... ${res.message}`);
      } catch (e) {
        if (mine !== gen) return;
        stop();
        status(`Recording... effects are off: ${e instanceof Error ? e.message : e}`);
      }
    },
  };
}
