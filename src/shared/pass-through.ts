import type { Rect } from './overlay-layout';

/** Half-open point-in-rect test, the rect grown by `pad` DIPs on every side (a forgiving edge around the toolbar). */
export function pointInRect(p: { x: number; y: number }, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x < r.x + r.width + pad && p.y >= r.y - pad && p.y < r.y + r.height + pad;
}

/** True when the cursor (screen DIPs) is over any of the rects the draw overlay must let clicks through to. */
export function overPassThrough(p: { x: number; y: number }, rects: readonly (Rect | null | undefined)[], pad = 0): boolean {
  return rects.some((r) => !!r && r.width > 0 && r.height > 0 && pointInRect(p, r, pad));
}
