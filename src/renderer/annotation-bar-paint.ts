import { PEN_COLORS, PEN_WIDTHS } from '../shared/annotation';
import { barLayout, widthDotSize, type BarState } from '../shared/annotation-bar';
import type { Rect } from '../shared/overlay-layout';

const BAR_BG = 'rgba(20, 22, 26, 0.92)';
const BUTTON_BG = '#3a3f48';
const INK = '#e8eaed';
/** The layout is constant: computed once instead of on every recorded frame. */
let layout: ReturnType<typeof barLayout> | null = null;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Paints the overlay toolbar into the recording. `ox` / `oy` is the bar's top-left in canvas pixels and `k` the canvas
 * pixels per overlay DIP (the same scale as pen widths), so it follows the auto-zoom exactly like the strokes.
 * Geometry comes from barLayout(), the same source the on-screen bar is built from.
 */
export function paintBar(
  ctx: CanvasRenderingContext2D, bar: BarState, ox: number, oy: number, k: number, cursor?: { x: number; y: number } | null,
): void {
  const L = layout ?? (layout = barLayout());
  const at = (r: Rect): Rect => ({ x: ox + r.x * k, y: oy + r.y * k, width: r.width * k, height: r.height * k });
  const ring = (r: Rect, round: boolean, pad: number): void => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * k;
    if (round) { ctx.beginPath(); ctx.arc(r.x + r.width / 2, r.y + r.height / 2, r.width / 2 - pad * k, 0, Math.PI * 2); }
    else roundRectPath(ctx, r.x + pad * k, r.y + pad * k, r.width - 2 * pad * k, r.height - 2 * pad * k, 6 * k);
    ctx.stroke();
  };
  ctx.save();
  ctx.fillStyle = BAR_BG;
  roundRectPath(ctx, ox, oy, L.width * k, L.height * k, 10 * k);
  ctx.fill();

  // Grip: two columns of three dots.
  const g = at(L.grip);
  ctx.fillStyle = '#9aa0a6';
  for (const cx of [0.35, 0.65]) {
    for (const cy of [0.3, 0.5, 0.7]) {
      ctx.beginPath();
      ctx.arc(g.x + g.width * cx, g.y + g.height * cy, 1.5 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  PEN_COLORS.forEach((c, i) => {
    const r = at(L.swatches[i]);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, 0, Math.PI * 2);
    ctx.fill();
    if (c === bar.color) ring(r, true, 1);
  });

  PEN_WIDTHS.forEach((w, i) => {
    const r = at(L.widths[i]);
    ctx.fillStyle = BUTTON_BG;
    roundRectPath(ctx, r.x, r.y, r.width, r.height, 6 * k);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(r.x + r.width / 2, r.y + r.height / 2, (widthDotSize(w) * k) / 2, 0, Math.PI * 2);
    ctx.fill();
    if (w === bar.width) ring(r, false, 1);
  });

  ctx.font = `${13 * k}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [rect, label] of [[L.clear, 'Clear'], [L.close, 'Close']] as const) {
    const r = at(rect);
    ctx.fillStyle = BUTTON_BG;
    roundRectPath(ctx, r.x, r.y, r.width, r.height, 6 * k);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillText(label, r.x + r.width / 2, r.y + r.height / 2);
  }
  if (cursor) paintCursor(ctx, cursor.x, cursor.y, k);
  ctx.restore();
}

/** Arrow outline (DIP, tip at 0,0), about 12x19. */
const ARROW: readonly (readonly [number, number])[] = [[0, 0], [0, 17], [4, 13], [7, 19], [9.5, 18], [6.5, 12], [12, 12]];

/** The OS cursor is baked into the captured frame below the bar; this puts an arrow back on top of it. */
function paintCursor(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  ctx.beginPath();
  ARROW.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(x + px * k, y + py * k); else ctx.lineTo(x + px * k, y + py * k); });
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = k;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();
}
