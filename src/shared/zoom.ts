import type { Point, Rect, Size } from './overlay-layout';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export const MAX_ZOOM = 8;
/** How long the zoom stays on a click before easing back out. */
export const ZOOM_HOLD_MS = 2200;
/** Time constants (ms) of the exponential easing: zoom in fast, pan a bit slower. */
export const ZOOM_TAU_MS = 220;
export const PAN_TAU_MS = 300;

/** Manual (hotkey) zoom: steps of 0.5 between 1x and 4x. */
export const MANUAL_ZOOM_STEP = 0.5;
export const MANUAL_ZOOM_MIN = 1;
export const MANUAL_ZOOM_MAX = 4;

export type ZoomCommand = 'zoomIn' | 'zoomOut' | 'zoomReset';

/** Clamp a manual level to [1, 4] and snap it to the 0.5 grid (non-finite -> 1). */
export function clampManualZoom(level: number): number {
  if (!finite(level)) return MANUAL_ZOOM_MIN;
  const snapped = Math.round(level / MANUAL_ZOOM_STEP) * MANUAL_ZOOM_STEP;
  return clamp(snapped, MANUAL_ZOOM_MIN, MANUAL_ZOOM_MAX);
}

/** The manual level after a hotkey command. */
export function stepManualZoom(level: number, cmd: ZoomCommand): number {
  if (cmd === 'zoomReset') return MANUAL_ZOOM_MIN;
  const cur = clampManualZoom(level);
  return clampManualZoom(cur + (cmd === 'zoomIn' ? MANUAL_ZOOM_STEP : -MANUAL_ZOOM_STEP));
}

/** Zoom factor and the center of the view, in frame pixels. */
export interface ZoomState { zoom: number; cx: number; cy: number }
export interface ClickMark { x: number; y: number; at: number }

export function initialZoom(frame: Size): ZoomState {
  return { zoom: 1, cx: frame.width / 2, cy: frame.height / 2 };
}

/**
 * The part of the frame to show for `zoom` centered on `center`. The rect always lies inside the frame
 * (the center is shifted near the edges), keeps the frame's aspect ratio and never zooms out past 1x.
 */
export function zoomViewRect(frame: Size, center: Point, zoom: number): Rect {
  const fw = finite(frame.width) ? Math.max(0, frame.width) : 0;
  const fh = finite(frame.height) ? Math.max(0, frame.height) : 0;
  const z = finite(zoom) ? clamp(zoom, 1, MAX_ZOOM) : 1;
  const w = fw / z;
  const h = fh / z;
  const cx = finite(center.x) ? center.x : fw / 2;
  const cy = finite(center.y) ? center.y : fh / 2;
  return { x: clamp(cx - w / 2, 0, fw - w), y: clamp(cy - h / 2, 0, fh - h), width: w, height: h };
}

/** Frame-rate independent exponential easing of `cur` toward `target` (snaps when within 0.001). */
export function approach(cur: number, target: number, dtMs: number, tauMs: number): number {
  if (!finite(cur)) return finite(target) ? target : 0;
  if (!finite(target)) return cur;
  if (!finite(dtMs) || dtMs <= 0) return cur;
  const k = tauMs > 0 ? 1 - Math.exp(-dtMs / tauMs) : 1;
  const next = cur + (target - cur) * k;
  return Math.abs(target - next) < 0.001 ? target : next;
}

/** Zoom level wanted at `now`: `strength` while the last click is recent, 1 otherwise. */
export function zoomGoal(strength: number, click: ClickMark | null, now: number, holdMs = ZOOM_HOLD_MS): number {
  if (!click || !finite(strength) || strength <= 1) return 1;
  return now - click.at <= holdMs ? clamp(strength, 1, MAX_ZOOM) : 1;
}

/**
 * Advance the zoom animation by `dtMs`. While zoomed out the center snaps to the click (nothing of it is
 * visible yet), so zooming in starts at the click instead of sweeping across the screen.
 */
export function stepZoom(s: ZoomState, goalZoom: number, click: ClickMark | null, frame: Size, dtMs: number): ZoomState {
  const fw = finite(frame.width) ? Math.max(0, frame.width) : 0;
  const fh = finite(frame.height) ? Math.max(0, frame.height) : 0;
  const target = click ? { x: click.x, y: click.y } : { x: s.cx, y: s.cy };
  const snap = s.zoom < 1.02 && goalZoom > 1;
  const cx = snap ? target.x : approach(s.cx, target.x, dtMs, PAN_TAU_MS);
  const cy = snap ? target.y : approach(s.cy, target.y, dtMs, PAN_TAU_MS);
  return {
    zoom: clamp(approach(s.zoom, goalZoom, dtMs, ZOOM_TAU_MS), 1, MAX_ZOOM),
    cx: clamp(finite(cx) ? cx : fw / 2, 0, fw),
    cy: clamp(finite(cy) ? cy : fh / 2, 0, fh),
  };
}

/** Frame pixel -> canvas pixel, given the visible part of the frame (`view`) and where it is drawn (`dest`). */
export function frameToCanvas(p: Point, view: Rect, dest: Rect): Point {
  if (view.width <= 0 || view.height <= 0) return { x: dest.x, y: dest.y };
  return {
    x: dest.x + ((p.x - view.x) / view.width) * dest.width,
    y: dest.y + ((p.y - view.y) / view.height) * dest.height,
  };
}
