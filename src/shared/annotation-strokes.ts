import { sanitizeBarState, type BarState } from './annotation-bar';
import { MAX_POINTS_PER_STROKE, MAX_STROKES, PEN_COLORS, PEN_WIDTHS } from './annotation';
import type { Point, Rect, Size } from './overlay-layout';
import { frameToCanvas } from './zoom';

/** Overlay page -> main (ipcRenderer.send, one finished stroke / a clear). */
export const ANNOTATION_CHANNELS = { stroke: 'annotation:stroke', clear: 'annotation:clear', bar: 'annotation:bar' } as const;
/** Main -> main-window renderer. */
export const ANNOTATION_EVENT = 'annotation:event';

/**
 * A pen stroke: `pts` is a flat [x0, y0, x1, y1, ...] list, each coordinate a 0..1 fraction of the overlay display.
 * `id` is chosen by the overlay page (unique per overlay session) so a stroke can be sent while it is still being drawn.
 */
export interface PenStroke { id: number; color: string; width: number; pts: number[] }
/**
 * One message about a stroke while the pen is down (or its final one). Only the points added since the previous
 * message are sent: `pts` continues the stroke at coordinate index `from` (0 = the first message, which also replaces
 * any stroke with that id). This keeps each message small instead of resending up to 8k numbers ~25 times a second.
 * IPC from one sender and the main-process queue keep order, so an append whose `from` does not match the stored
 * length (e.g. its stroke was cleared or evicted) is simply ignored.
 */
export interface StrokeUpdate extends PenStroke { from: number }
export type CaptureKind = 'screen' | 'window' | 'none';
/**
 * The display the strokes were drawn on, stamped by the main process. `widthDip` converts widths to fractions.
 * `onCapture` is decided in main (see decideCaptureMatch); `captureKind` / `captureDisplayId` ('' = unknown) are
 * only there to explain a mismatch to the user.
 */
export interface AnnotationDisplay {
  id: string; widthDip: number; onCapture: boolean; captureKind: CaptureKind; captureDisplayId: string;
}
export type AnnotationEvent =
  | { t: 'stroke'; stroke: StrokeUpdate; display: AnnotationDisplay }
  | { t: 'bar'; bar: BarState; display: AnnotationDisplay }
  | { t: 'clear' };

/** The oldest strokes are dropped once the store holds more than this many coordinates in total. */
export const MAX_TOTAL_COORDS = 400_000;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validate one stroke message from an untrusted sender. Anything unusable (bad id/from/color/width, NaN, out of range, too long) is null. */
export function sanitizeStrokeUpdate(raw: unknown): StrokeUpdate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || id > 0x7fffffff) return null;
  const from = r.from;
  if (typeof from !== 'number' || !Number.isSafeInteger(from) || from < 0 || from >= MAX_POINTS_PER_STROKE * 2 || from % 2 !== 0) return null;
  const color = PEN_COLORS.find((c) => c === r.color);
  const width = PEN_WIDTHS.find((w) => w === r.width);
  if (!color || !width) return null;
  const src = r.pts;
  if (!Array.isArray(src) || src.length < 2 || src.length > MAX_POINTS_PER_STROKE * 2 || src.length % 2 !== 0) return null;
  const pts: number[] = new Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v: unknown = src[i];
    if (!finite(v) || v < 0 || v > 1) return null;
    pts[i] = v;
  }
  return { id, color, width, pts, from };
}

/** Validate the display tag of a forwarded event. */
export function sanitizeAnnotationDisplay(raw: unknown): AnnotationDisplay | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return null;
  if (!finite(r.widthDip) || r.widthDip <= 0 || r.widthDip > 100_000) return null;
  const captureKind: CaptureKind = r.captureKind === 'screen' || r.captureKind === 'window' ? r.captureKind : 'none';
  const cd = typeof r.captureDisplayId === 'string' && r.captureDisplayId.length <= 64 ? r.captureDisplayId : '';
  return { id: r.id, widthDip: r.widthDip, onCapture: r.onCapture === true, captureKind, captureDisplayId: cd };
}

/** Validate an event received by the main-window renderer. */
export function parseAnnotationEvent(raw: unknown): AnnotationEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.t === 'clear') return { t: 'clear' };
  if (r.t === 'bar') {
    const bar = sanitizeBarState(r.bar);
    const display = sanitizeAnnotationDisplay(r.display);
    return bar && display ? { t: 'bar', bar, display } : null;
  }
  if (r.t !== 'stroke') return null;
  const stroke = sanitizeStrokeUpdate(r.stroke);
  const display = sanitizeAnnotationDisplay(r.display);
  return stroke && display ? { t: 'stroke', stroke, display } : null;
}

export interface StrokeStore {
  /** Upsert by id (from 0 replaces / creates, from > 0 appends to the stored stroke). */
  apply(update: StrokeUpdate, display: AnnotationDisplay): void;
  clear(): void;
  strokes(): readonly PenStroke[];
  display(): AnnotationDisplay | null;
}

/** In-memory strokes, bounded by count and total size (oldest dropped first). Strokes are never persisted. */
export function createStrokeStore(): StrokeStore {
  let list: PenStroke[] = [];
  let disp: AnnotationDisplay | null = null;
  let total = 0;
  const maxCoords = MAX_POINTS_PER_STROKE * 2;
  const trim = () => { while (list.length > MAX_STROKES || (total > MAX_TOTAL_COORDS && list.length > 1)) total -= list.shift()!.pts.length; };
  return {
    apply(u, display) {
      const sameDisplay = disp?.id === display.id;
      if (u.from > 0) {
        // Append: only to the same stroke on the same display and only exactly where it ends.
        const cur = sameDisplay ? list.find((s) => s.id === u.id) : undefined;
        if (!cur || cur.pts.length !== u.from) return;
        const take = Math.min(u.pts.length, maxCoords - cur.pts.length) & ~1; // never past the per-stroke cap, keep x/y pairs
        if (take <= 0) return;
        for (let i = 0; i < take; i++) cur.pts.push(u.pts[i]);
        total += take;
        disp = display;
        trim();
        return;
      }
      // Strokes of one display only: a stroke from another display replaces the old set.
      if (disp && !sameDisplay) { list = []; total = 0; }
      disp = display;
      const next: PenStroke = { id: u.id, color: u.color, width: u.width, pts: u.pts.slice(0, maxCoords) };
      const at = list.findIndex((s) => s.id === u.id);
      if (at >= 0) { total -= list[at].pts.length; list[at] = next; } else list.push(next);
      total += next.pts.length;
      trim();
    },
    clear() { list = []; disp = null; total = 0; },
    strokes: () => list,
    display: () => disp,
  };
}

/** Kind of capture source from its id ('screen:...' / 'window:...'). */
export function captureKindOf(sourceId: string | null | undefined): CaptureKind {
  if (typeof sourceId !== 'string') return 'none';
  return sourceId.startsWith('screen:') ? 'screen' : sourceId.startsWith('window:') ? 'window' : 'none';
}

/**
 * Main-process decision: do strokes drawn on the overlay display belong on the captured source? Only screen sources
 * qualify. When the captured display is unknown (empty / unresolvable display_id, common on Windows) the overlay was
 * opened on the captured display by construction, so it matches; otherwise the display ids must be equal.
 */
export function decideCaptureMatch(kind: CaptureKind, capturedDisplayId: string | null, overlayDisplayId: string): boolean {
  if (kind !== 'screen') return false;
  return capturedDisplayId ? capturedDisplayId === overlayDisplayId : true;
}

/** Why the latest strokes cannot be drawn into the recording (null = they can). Shown once per reason. */
export function annotationSkipReason(display: AnnotationDisplay | null, rendererSourceId: string | null): string | null {
  if (!display) return null;
  const kind = captureKindOf(rendererSourceId);
  if (kind === 'none') return 'Annotation not drawn: no screen source selected';
  if (kind === 'window') return 'Annotation not drawn: capture source is a window (only screen sources show annotations)';
  if (display.onCapture) return null;
  if (display.captureKind !== 'screen') return `Annotation not drawn: the main process sees the capture source as ${display.captureKind}`;
  return `Annotation not drawn: display mismatch (overlay display ${display.id} vs capture ${display.captureDisplayId || 'unknown'})`;
}

/**
 * Same question answered in the main process, from the display tag alone (it knows the capture source itself).
 * Shown on the draw overlay, where the user is looking while drawing; the recorder window may be minimized.
 */
export function overlaySkipReason(display: AnnotationDisplay): string | null {
  if (display.onCapture) return null;
  if (display.captureKind === 'window') return 'Not recorded: a window is being captured, only a screen shows annotations';
  if (display.captureKind === 'none') return 'Not recorded: no screen is selected in the recorder';
  return `Not recorded: this display (${display.id}) is not the captured one (${display.captureDisplayId || 'unknown'})`;
}

/** Normalized stroke point -> canvas pixel through the frame -> (view -> dest) transform used for the video frame. */
export function strokePointToCanvas(fx: number, fy: number, frame: Size, view: Rect, dest: Rect): Point {
  return frameToCanvas({ x: fx * frame.width, y: fy * frame.height }, view, dest);
}

/** Canvas pixels per overlay DIP, for pen widths. */
export function strokePxPerDip(display: AnnotationDisplay, frame: Size, view: Rect, dest: Rect): number {
  if (view.width <= 0 || display.widthDip <= 0) return 0;
  return (frame.width / display.widthDip) * (dest.width / view.width);
}
