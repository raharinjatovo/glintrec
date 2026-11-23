import type { Rect, Size } from './overlay-layout';

/** The part of the captured frame that ends up in the video, as 0..1 fractions of the frame. */
export interface CaptureRegion { x: number; y: number; w: number; h: number }

/** A region covering (nearly) the whole frame is not worth outlining. */
const FULL_EPS = 0.01;
const MIN_SIZE = 0.01;

/** Region for the visible part `view` of `frame`; null when it is the whole frame or unusable. */
export function regionFromView(view: Rect, frame: Size): CaptureRegion | null {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  const x = view.x / frame.width;
  const y = view.y / frame.height;
  const w = view.width / frame.width;
  const h = view.height / frame.height;
  if (![x, y, w, h].every(Number.isFinite) || w < MIN_SIZE || h < MIN_SIZE) return null;
  if (w >= 1 - FULL_EPS && h >= 1 - FULL_EPS) return null;
  const cx = Math.min(1 - Math.min(1, w), Math.max(0, x));
  const cy = Math.min(1 - Math.min(1, h), Math.max(0, y));
  return { x: cx, y: cy, w: Math.min(1, w), h: Math.min(1, h) };
}

export function sameRegion(a: CaptureRegion | null, b: CaptureRegion | null, eps = 0.002): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;
}

/** Validates a renderer message; null (hide the frame) for anything that is not a usable region. */
export function sanitizeCaptureRegion(raw: unknown): CaptureRegion | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { x, y, w, h } = r;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') return null;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w < MIN_SIZE || h < MIN_SIZE || w > 1 || h > 1 || x < -FULL_EPS || y < -FULL_EPS) return null;
  return { x: Math.min(1 - w, Math.max(0, x)), y: Math.min(1 - h, Math.max(0, y)), w, h };
}
