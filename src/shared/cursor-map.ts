import type { DisplayInfo } from './ipc';
import type { Point, Size } from './overlay-layout';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validate a display description from the main process; anything unusable (zero size, NaN, ...) is null. */
export function sanitizeDisplayInfo(raw: unknown): DisplayInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const b = r.bounds as Record<string, unknown> | null | undefined;
  if (typeof b !== 'object' || b === null) return null;
  if (!finite(b.x) || !finite(b.y) || !finite(b.width) || !finite(b.height) || b.width <= 0 || b.height <= 0) return null;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return null;
  const scale = finite(r.scaleFactor) && r.scaleFactor > 0 ? Math.min(8, Math.max(0.5, r.scaleFactor)) : 1;
  return { id: r.id, bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, scaleFactor: scale };
}

const validSize = (s: Size) => finite(s.width) && finite(s.height) && s.width > 0 && s.height > 0;

/**
 * Cursor position in screen DIPs -> pixel position inside the captured frame of `display`.
 * The position is taken as a fraction of the display bounds, so the DPI scale factor and any capture
 * resolution that differs from bounds * scaleFactor cancel out. null when the point is not on this
 * display (another monitor, off-screen) or an input is unusable: callers then draw nothing.
 */
export function mapCursorToFrame(p: Point, display: DisplayInfo, frame: Size): Point | null {
  if (!finite(p.x) || !finite(p.y) || !validSize(frame)) return null;
  const { x, y, width, height } = display.bounds;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || width <= 0 || height <= 0) return null;
  const fx = (p.x - x) / width;
  const fy = (p.y - y) / height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return { x: fx * frame.width, y: fy * frame.height };
}

/** Frame pixels per DIP: sizes given in screen DIPs (halo radius) are scaled with this. */
export function framePxPerDip(display: DisplayInfo, frame: Size | null): number {
  const w = display.bounds.width;
  if (frame && validSize(frame) && finite(w) && w > 0) return frame.width / w;
  return finite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
}

/**
 * The display a `screen:` capture source shows, or null when that cannot be told (window sources, a
 * source without display_id on a multi-monitor desktop): cursor effects are then skipped, not guessed.
 */
export function resolveDisplayForSource(
  sourceId: string | null, sources: { id: string; display_id: string }[], displays: DisplayInfo[],
): DisplayInfo | null {
  if (typeof sourceId !== 'string' || !sourceId.startsWith('screen:')) return null;
  const src = sources.find((s) => s.id === sourceId);
  if (!src) return null;
  const byId = src.display_id ? displays.find((d) => d.id === src.display_id) : undefined;
  if (byId) return byId;
  return !src.display_id && displays.length === 1 ? displays[0] : null;
}
