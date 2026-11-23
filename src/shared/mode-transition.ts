/** Pure logic for the live camera-only <-> screen+camera shrink/grow transition in the compositor. */
import type { Shape } from './ipc';
import { coverCrop, ROUNDED_RADIUS_RATIO, type Rect, type Size } from './overlay-layout';

export type CaptureModeName = 'screen' | 'camera';

export const MODE_TRANSITION_MS = 450;
/** Incoming layer starts slightly zoomed out and settles to 1. */
export const MODE_TRANSITION_START_SCALE = 0.96;

export interface ModeTransition {
  from: CaptureModeName;
  to: CaptureModeName;
  startedAt: number;
}

/** A transition starts when the mode changed between consecutive draws and a previous frame exists. */
export function detectModeChange(
  prev: CaptureModeName | null, next: CaptureModeName, hasPrevFrame: boolean,
): boolean {
  return hasPrevFrame && prev !== null && prev !== next;
}

export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return c * c * (3 - 2 * c);
}

/** Linear progress 0..1 (1 when finished or the clock is unusable). */
export function transitionProgress(startedAt: number, now: number, durationMs = MODE_TRANSITION_MS): number {
  if (!(durationMs > 0) || !Number.isFinite(now) || !Number.isFinite(startedAt)) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / durationMs));
}

export function transitionDone(startedAt: number, now: number, durationMs = MODE_TRANSITION_MS): boolean {
  return transitionProgress(startedAt, now, durationMs) >= 1;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return {
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t), height: lerp(a.height, b.height, t),
  };
}

/** Corner radius of the camera bubble (same rule as the compositor's clip path). */
export function bubbleRadius(shape: Shape, rect: Rect): number {
  const m = Math.min(rect.width, rect.height);
  return shape === 'circle' ? m / 2 : m * ROUNDED_RADIUS_RATIO;
}

export interface MorphFrame {
  /** Where the camera layer is drawn on the canvas. */
  rect: Rect;
  /** Part of the full-canvas camera layer that is shown in `rect` (cover crop toward the bubble aspect). */
  src: Rect;
  radius: number;
  /** 0 = full-canvas camera-only, 1 = bubble in screen mode (eased, direction aware). */
  t: number;
  screenAlpha: number;
  screenScale: number;
  /** Bubble border opacity (fades in while shrinking, out while growing). */
  borderAlpha: number;
}

/**
 * Shared-element transition between camera-only (full canvas) and the camera bubble of screen mode.
 * `toScreen`: camera-only -> screen+camera (shrink); otherwise grow. At progress 0 and 1 the frame
 * equals the plain composition of the start/end mode.
 */
export function morphFrame(
  progress: number, toScreen: boolean, canvas: Size, bubble: Rect, bubbleRad: number,
): MorphFrame {
  const e = easeInOut(progress);
  const t = toScreen ? e : 1 - e;
  const full: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const fullSrc = full;
  const bubbleSrc = coverCrop(canvas, bubble);
  const rect = lerpRect(full, bubble, t);
  const radius = Math.min(lerp(0, bubbleRad, t), Math.min(rect.width, rect.height) / 2);
  return {
    rect, src: lerpRect(fullSrc, bubbleSrc, t), radius, t,
    screenAlpha: t,
    screenScale: lerp(MODE_TRANSITION_START_SCALE, 1, t),
    borderAlpha: t,
  };
}

/** Alpha of the incoming layer and its scale (about the canvas centre) for a given progress. */
export function transitionFrame(progress: number): { alpha: number; scale: number } {
  const e = easeInOut(progress);
  return { alpha: e, scale: MODE_TRANSITION_START_SCALE + (1 - MODE_TRANSITION_START_SCALE) * e };
}
