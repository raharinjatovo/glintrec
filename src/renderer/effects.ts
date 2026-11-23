import type { DisplayInfo, EffectSettings, InputEvent } from '../shared/ipc';
import { framePxPerDip, mapCursorToFrame } from '../shared/cursor-map';
import { KEY_RING_SIZE, visibleKeys, type KeyEntry } from '../shared/key-display';
import type { Point, Rect, Size } from '../shared/overlay-layout';
import { addRipple, pruneRipples, rippleFrame, type Ripple } from '../shared/ripples';
import { createRing } from '../shared/ring-buffer';
import {
  frameToCanvas, initialZoom, stepManualZoom, stepZoom, zoomGoal, zoomViewRect, type ClickMark, type ZoomCommand,
  type ZoomState,
} from '../shared/zoom';

/** What the compositor needs from the effects: which part of the frame to draw, and what to draw on top. */
export interface EffectsLayer {
  /** Advances the animations and returns the part of the captured frame to show (the whole frame when not zoomed). */
  beginFrame(now: number, frame: Size): Rect;
  /** Cursor halo and click ripples, positioned through `view` (visible frame part) -> `dest` (where the frame is drawn). */
  drawWorld(ctx: CanvasRenderingContext2D, view: Rect, dest: Rect, frame: Size, now: number): void;
  /** Cursor position in frame pixels; null when unknown or the display is only a guess. */
  cursorFramePoint(frame: Size): Point | null;
  /** Screen-fixed parts (keystroke pill). */
  drawOverlay(ctx: CanvasRenderingContext2D, canvas: Size, now: number): void;
}
export interface Effects extends EffectsLayer {
  /** Display being captured; null = unknown, then cursor effects and zoom are skipped. */
  setDisplay(d: DisplayInfo | null, approximate?: boolean): void;
  push(ev: InputEvent, now?: number): void;
  reset(): void;
  /** Hotkey zoom step; returns the new manual level (1 = off). */
  zoomBy(cmd: ZoomCommand): number;
  /** Current manual level (1 = off). */
  manualLevel(): number;
  /** Real (smoothed) zoom factor of the last drawn view; 1 when not zoomed. */
  zoomFactor(): number;
}

const HALO_RADIUS_DIP = 26;
const RIPPLE_RADIUS_DIP = 46;
const RIPPLE_COLORS = { left: '64,160,255', right: '255,159,10', middle: '52,199,89' };
const MAX_FRAME_DT_MS = 250;

/** All positions are kept in screen DIPs and mapped to the frame at draw time (the frame size can change). */
export function createEffects(getFx: () => EffectSettings): Effects {
  let display: DisplayInfo | null = null;
  let approx = false; // display is a guess: manual zoom only, no halo/ripples
  let cursor: Point | null = null;
  let lastClick: { x: number; y: number; at: number } | null = null;
  let ripples: Ripple[] = [];
  const keys = createRing<KeyEntry>(KEY_RING_SIZE);
  let zoom: ZoomState | null = null;
  let lastT = 0;
  let manual = 1;

  const onDisplay = (p: Point): boolean => !!display && mapCursorToFrame(p, display, { width: 1, height: 1 }) !== null;

  return {
    setDisplay(d, approximate = false) { display = d; approx = approximate; },
    push(ev, now = performance.now()) {
      if (ev.t === 'cursor') cursor = { x: ev.x, y: ev.y };
      else if (ev.t === 'click') {
        if (!onDisplay(ev)) return;
        lastClick = { x: ev.x, y: ev.y, at: now };
        if (getFx().clickRipples) ripples = addRipple(ripples, { x: ev.x, y: ev.y, at: now, button: ev.button });
      } else if (getFx().keystrokes) keys.push({ text: ev.text, combo: ev.combo, at: now });
    },
    zoomBy(cmd) { manual = stepManualZoom(manual, cmd); return manual; },
    manualLevel: () => manual,
    zoomFactor: () => zoom?.zoom ?? 1,
    cursorFramePoint(frame) { return cursor && display && !approx ? mapCursorToFrame(cursor, display, frame) : null; },
    reset() {
      manual = 1;
      display = null; approx = false; cursor = null; lastClick = null; ripples = []; keys.clear(); zoom = null; lastT = 0;
    },

    beginFrame(now, frame) {
      const strength = getFx().autoZoom;
      if (!display || ((strength <= 1 || approx) && manual <= 1 && (!zoom || zoom.zoom <= 1)) || frame.width <= 0 || frame.height <= 0) {
        zoom = null;
        return { x: 0, y: 0, width: frame.width, height: frame.height };
      }
      const dt = lastT > 0 ? Math.min(MAX_FRAME_DT_MS, now - lastT) : 0;
      lastT = now;
      if (manual > 1) {
        // Manual level overrides click auto-zoom; the view follows the (smoothed) cursor.
        const c = cursor ? mapCursorToFrame(cursor, display, frame) : null;
        const m: ClickMark | null = c ? { x: c.x, y: c.y, at: now } : null;
        zoom = stepZoom(zoom ?? initialZoom(frame), manual, m, frame, dt);
        return zoomViewRect(frame, { x: zoom.cx, y: zoom.cy }, zoom.zoom);
      }
      const f = lastClick && !approx ? mapCursorToFrame(lastClick, display, frame) : null;
      const mark: ClickMark | null = f && lastClick ? { x: f.x, y: f.y, at: lastClick.at } : null;
      zoom = stepZoom(zoom ?? initialZoom(frame), zoomGoal(strength, mark, now), mark, frame, dt);
      return zoomViewRect(frame, { x: zoom.cx, y: zoom.cy }, zoom.zoom);
    },

    drawWorld(ctx, view, dest, frame, now) {
      const fx = getFx();
      if (!display || approx || view.width <= 0 || (!fx.cursorHighlight && !fx.clickRipples)) return;
      const dip = framePxPerDip(display, frame) * (dest.width / view.width); // canvas pixels per DIP
      const at = (p: Point): Point | null => {
        const f = mapCursorToFrame(p, display!, frame);
        return f ? frameToCanvas(f, view, dest) : null;
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(dest.x, dest.y, dest.width, dest.height);
      ctx.clip();
      if (fx.clickRipples) {
        ripples = pruneRipples(ripples, now);
        for (const r of ripples) {
          const p = at(r);
          const a = p && rippleFrame(r, now, RIPPLE_RADIUS_DIP * dip);
          if (!p || !a) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, a.radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${RIPPLE_COLORS[r.button]},${a.alpha})`;
          ctx.lineWidth = Math.max(2, 3 * dip);
          ctx.stroke();
        }
      }
      const c = fx.cursorHighlight && cursor ? at(cursor) : null;
      if (c) {
        const r = HALO_RADIUS_DIP * dip;
        const g = ctx.createRadialGradient(c.x, c.y, r * 0.2, c.x, c.y, r);
        g.addColorStop(0, 'rgba(255,214,10,0.38)');
        g.addColorStop(1, 'rgba(255,214,10,0.14)');
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,214,10,0.75)';
        ctx.lineWidth = Math.max(1.5, 2 * dip);
        ctx.stroke();
      }
      ctx.restore();
    },

    drawOverlay(ctx, canvas, now) {
      if (!getFx().keystrokes) return;
      const shown = visibleKeys(keys.toArray(), now);
      if (!shown) return;
      const px = Math.max(16, Math.round(Math.min(canvas.width, canvas.height) * 0.04));
      ctx.save();
      ctx.font = `600 ${px}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(shown.text).width + px * 1.4;
      const h = px * 1.8;
      const x = (canvas.width - w) / 2;
      const y = canvas.height - h - px * 1.2;
      ctx.globalAlpha = shown.alpha;
      ctx.fillStyle = 'rgba(20,22,26,0.85)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(shown.text, canvas.width / 2, y + h / 2);
      ctx.restore();
    },
  };
}
