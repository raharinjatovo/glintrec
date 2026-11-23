import type { Corner, Shape } from './ipc';

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function overlayAspect(shape: Shape): number {
  return shape === 'circle' ? 1 : 16 / 9;
}

export function computeOverlayRect(
  canvas: Size,
  opts: { corner: Corner; sizePercent: number; marginPercent: number; aspect?: number },
): Rect {
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1;
  const width = Math.round((canvas.width * clamp(opts.sizePercent, 10, 40)) / 100);
  const height = Math.round(width / aspect);
  const margin = Math.round((canvas.width * opts.marginPercent) / 100);
  const left = opts.corner.endsWith('left');
  const top = opts.corner.startsWith('top');
  const x = left ? margin : canvas.width - width - margin;
  const y = top ? margin : canvas.height - height - margin;
  return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

export interface Point { x: number; y: number }
export type OverlayPos = Point;
/** Corner radius of the 'rounded' shape, as a fraction of min(width, height). */
export const ROUNDED_RADIUS_RATIO = 0.18;

export interface OverlayLayoutOpts {
  corner: Corner;
  sizePercent: number;
  marginPercent: number;
  shape: Shape;
  pos: OverlayPos | null;
}

/**
 * The single source of truth for where the camera overlay sits (used by the compositor and by
 * hit-testing). With `pos` (normalized fractions of the free space) the overlay is placed at
 * left = x * (canvasW - w), top = y * (canvasH - h); otherwise it snaps to `corner`.
 */
export function overlayRectFor(canvas: Size, o: OverlayLayoutOpts): Rect {
  const base = computeOverlayRect(canvas, { ...o, aspect: overlayAspect(o.shape) });
  if (!o.pos) return base;
  const freeX = Math.max(0, canvas.width - base.width);
  const freeY = Math.max(0, canvas.height - base.height);
  return {
    ...base,
    x: Math.round(clamp(o.pos.x, 0, 1) * freeX),
    y: Math.round(clamp(o.pos.y, 0, 1) * freeY),
  };
}

/** True when `p` (canvas pixels) is inside the drawn shape (circle or rounded rectangle). */
export function hitTestOverlay(p: Point, rect: Rect, shape: Shape): boolean {
  const { x, y, width: w, height: h } = rect;
  if (p.x < x || p.y < y || p.x > x + w || p.y > y + h) return false;
  if (shape === 'circle') {
    const r = Math.min(w, h) / 2;
    return Math.hypot(p.x - (x + w / 2), p.y - (y + h / 2)) <= r;
  }
  const r = Math.min(w, h) * ROUNDED_RADIUS_RATIO;
  // Distance from the point to the inner (corner-centre) rectangle must be <= r.
  const dx = Math.max(x + r - p.x, 0, p.x - (x + w - r));
  const dy = Math.max(y + r - p.y, 0, p.y - (y + h - r));
  return Math.hypot(dx, dy) <= r;
}

/** Offset of the pointer inside the overlay at pointerdown, so the overlay does not jump. */
export function grabOffset(p: Point, rect: Rect): Point {
  return { x: p.x - rect.x, y: p.y - rect.y };
}

/** Pointer (canvas pixels) -> normalized pos, keeping the grab offset; always within [0,1] (never leaves the canvas). */
export function pointerToPos(p: Point, grab: Point, canvas: Size, overlay: Size): OverlayPos {
  const freeX = canvas.width - overlay.width;
  const freeY = canvas.height - overlay.height;
  return {
    x: freeX > 0 ? clamp((p.x - grab.x) / freeX, 0, 1) : 0,
    y: freeY > 0 ? clamp((p.y - grab.y) / freeY, 0, 1) : 0,
  };
}

/**
 * Client (CSS) coordinates -> canvas pixels. `box` is the canvas element's bounding rect; the canvas
 * is drawn object-fit: contain inside it, so the letterbox offset is removed.
 */
export function clientToCanvas(clientX: number, clientY: number, box: Rect, canvas: Size): Point {
  const shown = fitContain(canvas, { width: box.width, height: box.height });
  if (shown.width <= 0 || shown.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - box.x - shown.x) / shown.width) * canvas.width,
    y: ((clientY - box.y - shown.y) / shown.height) * canvas.height,
  };
}

/** Centered source rect that covers dest aspect (object-fit: cover). */
export function coverCrop(src: Size, dest: Size): Rect {
  if (src.width <= 0 || src.height <= 0 || dest.width <= 0 || dest.height <= 0) {
    return { x: 0, y: 0, width: src.width, height: src.height };
  }
  const srcAspect = src.width / src.height;
  const destAspect = dest.width / dest.height;
  if (srcAspect > destAspect) {
    const width = src.height * destAspect;
    return { x: (src.width - width) / 2, y: 0, width, height: src.height };
  }
  const height = src.width / destAspect;
  return { x: 0, y: (src.height - height) / 2, width: src.width, height };
}

/** Dest rect letterboxing src inside dest (object-fit: contain). */
export function fitContain(src: Size, dest: Size): Rect {
  if (src.width <= 0 || src.height <= 0) return { x: 0, y: 0, width: dest.width, height: dest.height };
  const scale = Math.min(dest.width / src.width, dest.height / src.height);
  const width = src.width * scale;
  const height = src.height * scale;
  return { x: (dest.width - width) / 2, y: (dest.height - height) / 2, width, height };
}

export const DEFAULT_CANVAS_SIZE: Size = { width: 1280, height: 720 };

/**
 * Source size the output canvas derives from: the screen in 'screen' mode, the camera in 'camera'
 * mode (default size until the camera is ready). null = not ready yet, keep the current size.
 */
export function canvasSourceSize(mode: 'screen' | 'camera', screen: Size | null, camera: Size | null): Size | null {
  const ok = (s: Size | null): s is Size => !!s && s.width > 0 && s.height > 0;
  if (mode === 'camera') return ok(camera) ? camera : DEFAULT_CANVAS_SIZE;
  return ok(screen) ? screen : null;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export function scaleToMax(src: Size, maxW: number, maxH: number): Size {
  const scale = Math.min(1, maxW / src.width, maxH / src.height);
  return { width: even(src.width * scale), height: even(src.height * scale) };
}

/** Window origin (screen DIPs) for a normalized overlay `pos` inside `area` (a display's bounds). */
export function posToWindowOrigin(pos: OverlayPos, area: Rect, win: Size): Point {
  const freeX = Math.max(0, area.width - win.width);
  const freeY = Math.max(0, area.height - win.height);
  return {
    x: Math.round(area.x + clamp(pos.x, 0, 1) * freeX),
    y: Math.round(area.y + clamp(pos.y, 0, 1) * freeY),
  };
}

/** Inverse of posToWindowOrigin: window origin -> normalized pos, clamped to [0,1]. */
export function windowOriginToPos(origin: Point, area: Rect, win: Size): OverlayPos {
  const freeX = area.width - win.width;
  const freeY = area.height - win.height;
  return {
    x: freeX > 0 ? clamp((origin.x - area.x) / freeX, 0, 1) : 0,
    y: freeY > 0 ? clamp((origin.y - area.y) / freeY, 0, 1) : 0,
  };
}
