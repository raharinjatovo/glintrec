import type { RecorderApi } from '../shared/ipc';
import {
  createStrokeStore, parseAnnotationEvent, strokePointToCanvas, strokePxPerDip, annotationSkipReason, type AnnotationDisplay, type PenStroke,
} from '../shared/annotation-strokes';
import type { Rect, Size } from '../shared/overlay-layout';
import type { BarState } from '../shared/annotation-bar';
import { paintBar } from './annotation-bar-paint';

/** Pen strokes from the draw overlay, composited into the recording canvas (screen sources only). */
export interface AnnotationLayer {
  /** Draws under the same view -> dest transform as the frame, so auto-zoom keeps strokes aligned. */
  draw(ctx: CanvasRenderingContext2D, view: Rect, dest: Rect, frame: Size): void;
}

/** `notify` shows a status message; it is called once per distinct reason a stroke cannot be drawn. */
export function createAnnotationLayer(
  api: RecorderApi, getSourceId: () => string | null, notify: (msg: string) => void,
): AnnotationLayer {
  const store = createStrokeStore();
  /** Latest toolbar state (drawn only while visible) and the display it belongs to. */
  let bar: { state: BarState; display: AnnotationDisplay } | null = null;
  let lastReason: string | null = null;
  /** The reason the strokes cannot be drawn (reported once), or null when they can. */
  function skipReason(): string | null {
    const reason = annotationSkipReason(store.display() ?? bar?.display ?? null, getSourceId());
    if (reason && reason !== lastReason) notify(reason);
    lastReason = reason;
    return reason;
  }
  api.onAnnotation((raw) => {
    const ev = parseAnnotationEvent(raw);
    if (!ev) return;
    if (ev.t === 'clear') { store.clear(); bar = null; lastReason = null; }
    else if (ev.t === 'bar') { bar = { state: ev.bar, display: ev.display }; skipReason(); }
    else { store.apply(ev.stroke, ev.display); skipReason(); }
  });

  function trace(ctx: CanvasRenderingContext2D, s: PenStroke, at: (i: number) => { x: number; y: number }): void {
    const n = s.pts.length / 2;
    ctx.beginPath();
    let p = at(0);
    ctx.moveTo(p.x, p.y);
    for (let i = 1; i < n - 1; i++) {
      p = at(i);
      const q = at(i + 1);
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    p = at(n - 1);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  return {
    draw(ctx, view, dest, frame) {
      const display = store.display() ?? bar?.display ?? null;
      const list = store.strokes();
      const showBar = bar?.state.visible === true;
      if (!display || (list.length === 0 && !showBar) || frame.width <= 0 || frame.height <= 0) return;
      if (skipReason()) return;
      const k = strokePxPerDip(display, frame, view, dest);
      if (k <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(dest.x, dest.y, dest.width, dest.height);
      ctx.clip();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of list) {
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = s.width * k;
        const at = (i: number) => strokePointToCanvas(s.pts[i * 2], s.pts[i * 2 + 1], frame, view, dest);
        if (s.pts.length === 2) {
          const p = at(0);
          ctx.beginPath();
          ctx.arc(p.x, p.y, (s.width * k) / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          trace(ctx, s, at);
        }
      }
      if (bar && showBar) {
        const o = strokePointToCanvas(bar.state.x, bar.state.y, frame, view, dest);
        const c = bar.state.cursor ? strokePointToCanvas(bar.state.cursor.x, bar.state.cursor.y, frame, view, dest) : null;
        paintBar(ctx, bar.state, o.x, o.y, strokePxPerDip(bar.display, frame, view, dest), c);
      }
      ctx.restore();
    },
  };
}
