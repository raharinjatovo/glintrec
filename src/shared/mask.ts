/** Pure helpers for turning segmenter confidence into a clean person alpha (kept DOM-free for testing). */

/** Confidence below LO is background, above HI is person; the ramp in between is the feathered edge. */
export const MASK_LO = 0.45;
export const MASK_HI = 0.7;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Alpha 0..1 for a smoothed confidence value; narrow band, slightly eroded (centre ~0.57) to kill halos. */
export function maskAlpha(confidence: number): number {
  return smoothstep(MASK_LO, MASK_HI, confidence);
}

/**
 * Temporal blend of the previous smoothed value with the new frame. Small changes are averaged
 * (less flicker); large changes take the new value almost entirely so a moving person leaves no ghost trail.
 */
export function blendConfidence(prev: number, next: number): number {
  const w = Math.min(1, 0.5 + 2 * Math.abs(next - prev));
  return w * next + (1 - w) * prev;
}

export const MIN_BLUR_PX = 8;
export const MAX_BLUR_PX = 60;

/** Blur radius actually drawn in blur mode: low slider values would leave the decor recognisable. */
export function effectiveBlurRadius(r: number): number {
  const v = Number.isFinite(r) ? r : MIN_BLUR_PX;
  return Math.min(MAX_BLUR_PX, Math.max(MIN_BLUR_PX, v));
}

/** Overscan margin (px) so the blur's transparent fringe falls outside the visible frame. */
export function blurOverscan(radius: number): number {
  return Math.ceil(effectiveBlurRadius(radius) * 2);
}

/** Feather radius (px at output resolution) when upscaling a low-res mask: ~0.4 mask texel, 1..3px. */
export function featherRadius(camWidth: number, maskWidth: number): number {
  if (!(maskWidth > 0) || !(camWidth > 0)) return 1;
  return Math.min(3, Math.max(1, (camWidth / maskWidth) * 0.4));
}
