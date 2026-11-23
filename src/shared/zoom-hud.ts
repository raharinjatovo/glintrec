import type { Rect } from './overlay-layout';

/** Renderer -> main (invoke): the zoom the recording is at right now, for the indicator window. */
export const ZOOM_HUD_CHANNEL = 'zoomhud:update';

export const ZOOM_HUD_MODES = ['none', 'manual', 'auto'] as const;
export type ZoomHudMode = (typeof ZOOM_HUD_MODES)[number];

/** Same bounds the compositor allows (MAX_ZOOM in zoom.ts); the HUD bar itself spans 1x to 4x (the manual range). */
export const ZOOM_HUD_MAX_FACTOR = 8;
const BAR_MAX = 4;
/** Below this the view counts as "not zoomed" (the easing never lands exactly on 1 until it snaps). */
const ZOOMED_FROM = 1.02;
const EPS = 1e-6;

export interface ZoomHudUpdate {
  /** Real, smoothed zoom factor of the view (1 = not zoomed). */
  factor: number;
  mode: ZoomHudMode;
  /** A zoom hotkey was pressed: pulse the HUD (and show it briefly even outside a recording). */
  flash: boolean;
}

/** What the HUD page displays; derived in main so the page only ever receives validated, fixed vocabulary. */
export interface ZoomHudView { text: string; label: string; mode: ZoomHudMode; fraction: number }

const LABELS: Record<ZoomHudMode, string> = { none: 'Pas de zoom', manual: 'Zoom manuel', auto: 'Zoom auto' };

/** Validates a renderer message; null when it is not usable. Values within rounding noise of the range are clamped. */
export function sanitizeZoomHudUpdate(raw: unknown): ZoomHudUpdate | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const f = r.factor;
  if (typeof f !== 'number' || !Number.isFinite(f) || f < 1 - EPS || f > ZOOM_HUD_MAX_FACTOR + EPS) return null;
  const mode = (ZOOM_HUD_MODES as readonly unknown[]).includes(r.mode) ? (r.mode as ZoomHudMode) : null;
  if (!mode) return null;
  return { factor: Math.min(ZOOM_HUD_MAX_FACTOR, Math.max(1, f)), mode, flash: r.flash === true };
}

/**
 * Which kind of zoom the view is in. A manual level wins over click auto-zoom (as in the effects layer); otherwise a
 * zoomed view is auto zoom when auto zoom is on, or the manual zoom easing back out after a reset when it is off.
 */
export function deriveZoomHud(factor: number, manualLevel: number, autoEnabled: boolean): ZoomHudMode {
  if (manualLevel > 1) return 'manual';
  if (!Number.isFinite(factor) || factor < ZOOMED_FROM) return 'none';
  return autoEnabled ? 'auto' : 'manual';
}

export function zoomHudLabel(mode: ZoomHudMode): string {
  return LABELS[mode];
}

export function formatZoomFactor(factor: number): string {
  const f = Number.isFinite(factor) ? Math.min(ZOOM_HUD_MAX_FACTOR, Math.max(1, factor)) : 1;
  return `${f.toFixed(1)}×`;
}

export function zoomHudView(u: Pick<ZoomHudUpdate, 'factor' | 'mode'>): ZoomHudView {
  const f = Math.min(ZOOM_HUD_MAX_FACTOR, Math.max(1, u.factor));
  return {
    text: formatZoomFactor(f),
    label: zoomHudLabel(u.mode),
    mode: u.mode,
    fraction: Math.min(1, Math.max(0, (f - 1) / (BAR_MAX - 1))),
  };
}

/** True when two updates would look the same on the HUD (used to send only on change). */
export function sameZoomHud(a: Pick<ZoomHudUpdate, 'factor' | 'mode'> | null, b: Pick<ZoomHudUpdate, 'factor' | 'mode'>): boolean {
  return !!a && a.mode === b.mode && Math.round(a.factor * 20) === Math.round(b.factor * 20);
}

export type ZoomHudCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** Window rectangle (DIPs) of the HUD inside a display's bounds. */
export function zoomHudRect(area: Rect, size: { width: number; height: number }, margin: number, corner: ZoomHudCorner = 'bottom-right'): Rect {
  const right = corner.endsWith('right');
  const bottom = corner.startsWith('bottom');
  return {
    x: right ? area.x + area.width - size.width - margin : area.x + margin,
    y: bottom ? area.y + area.height - size.height - margin : area.y + margin,
    width: size.width,
    height: size.height,
  };
}
