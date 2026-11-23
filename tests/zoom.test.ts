import { describe, expect, it } from 'vitest';
import {
  approach, frameToCanvas, initialZoom, MAX_ZOOM, stepZoom, ZOOM_HOLD_MS, zoomGoal, zoomViewRect, type ZoomState,
} from '../src/shared/zoom';

const F = { width: 1920, height: 1080 };

describe('zoomViewRect', () => {
  it('centers on the point and keeps the aspect ratio', () => {
    expect(zoomViewRect(F, { x: 960, y: 540 }, 2)).toEqual({ x: 480, y: 270, width: 960, height: 540 });
    expect(zoomViewRect(F, { x: 1000, y: 500 }, 1.5)).toEqual({ x: 360, y: 140, width: 1280, height: 720 });
  });

  it('never leaves the frame at the corners and edges', () => {
    expect(zoomViewRect(F, { x: 0, y: 0 }, 2)).toEqual({ x: 0, y: 0, width: 960, height: 540 });
    expect(zoomViewRect(F, { x: 1920, y: 1080 }, 2)).toEqual({ x: 960, y: 540, width: 960, height: 540 });
    expect(zoomViewRect(F, { x: 1900, y: 10 }, 2)).toEqual({ x: 960, y: 0, width: 960, height: 540 });
    expect(zoomViewRect(F, { x: -500, y: 9999 }, 2)).toEqual({ x: 0, y: 540, width: 960, height: 540 });
  });

  it('never zooms out past 1x and caps the zoom', () => {
    expect(zoomViewRect(F, { x: 5, y: 5 }, 0.3)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(zoomViewRect(F, { x: 5, y: 5 }, -2)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(zoomViewRect(F, { x: 5, y: 5 }, 1e9).width).toBe(1920 / MAX_ZOOM);
  });

  it('tolerates NaN / Infinity / empty frames', () => {
    expect(zoomViewRect(F, { x: NaN, y: NaN }, 2)).toEqual({ x: 480, y: 270, width: 960, height: 540 });
    expect(zoomViewRect(F, { x: 100, y: 100 }, NaN)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(zoomViewRect({ width: 0, height: 0 }, { x: 5, y: 5 }, 2)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(zoomViewRect({ width: NaN, height: -3 }, { x: 5, y: 5 }, 2)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('stays inside the frame for a sweep of centers and zooms', () => {
    for (let z = 0.5; z <= 10; z += 0.37) {
      for (let x = -300; x <= 2300; x += 173) {
        for (let y = -300; y <= 1400; y += 131) {
          const r = zoomViewRect(F, { x, y }, z);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width).toBeLessThanOrEqual(F.width + 1e-9);
          expect(r.y + r.height).toBeLessThanOrEqual(F.height + 1e-9);
        }
      }
    }
  });
});

describe('approach', () => {
  it('moves toward the target without overshooting, independent of step size', () => {
    const one = approach(1, 2, 100, 200);
    expect(one).toBeGreaterThan(1);
    expect(one).toBeLessThan(2);
    const split = approach(approach(1, 2, 50, 200), 2, 50, 200);
    expect(split).toBeCloseTo(one, 10);
  });
  it('snaps when close and holds on bad input', () => {
    expect(approach(1.9995, 2, 16, 220)).toBe(2);
    expect(approach(1, 2, 0, 200)).toBe(1);
    expect(approach(1, 2, -5, 200)).toBe(1);
    expect(approach(1, 2, NaN, 200)).toBe(1);
    expect(approach(NaN, 2, 10, 200)).toBe(2);
    expect(approach(1, NaN, 10, 200)).toBe(1);
    expect(approach(1, 2, 10, 0)).toBe(2);
  });
});

describe('zoomGoal', () => {
  const click = { x: 10, y: 10, at: 1000 };
  it('is the strength while the click is recent, 1 afterwards or without clicks / strength', () => {
    expect(zoomGoal(2, click, 1000)).toBe(2);
    expect(zoomGoal(2, click, 1000 + ZOOM_HOLD_MS)).toBe(2);
    expect(zoomGoal(2, click, 1000 + ZOOM_HOLD_MS + 1)).toBe(1);
    expect(zoomGoal(2, null, 1000)).toBe(1);
    expect(zoomGoal(1, click, 1000)).toBe(1);
    expect(zoomGoal(NaN, click, 1000)).toBe(1);
    expect(zoomGoal(100, click, 1000)).toBe(MAX_ZOOM);
  });
});

describe('stepZoom', () => {
  const run = (s: ZoomState, goal: number, click: { x: number; y: number; at: number } | null, ms: number, step = 16) => {
    for (let t = 0; t < ms; t += step) s = stepZoom(s, goal, click, F, step);
    return s;
  };

  it('zooms in toward the click, starting at the click rather than panning across the screen', () => {
    const click = { x: 200, y: 100, at: 0 };
    const first = stepZoom(initialZoom(F), 2, click, F, 16);
    expect(first.cx).toBe(200);
    expect(first.cy).toBe(100);
    expect(first.zoom).toBeGreaterThan(1);
    expect(first.zoom).toBeLessThan(2);
    const end = run(first, 2, click, 3000);
    expect(end.zoom).toBe(2);
    expect(zoomViewRect(F, { x: end.cx, y: end.cy }, end.zoom)).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });

  it('eases back out after the hold time and keeps the last center', () => {
    const click = { x: 1800, y: 1000, at: 0 };
    const zoomed = run(initialZoom(F), 2, click, 3000);
    const back = run(zoomed, 1, click, 4000);
    expect(back.zoom).toBe(1);
    expect(zoomViewRect(F, { x: back.cx, y: back.cy }, back.zoom)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('pans smoothly when a later click lands elsewhere while zoomed', () => {
    const zoomed = run(initialZoom(F), 2, { x: 200, y: 200, at: 0 }, 3000);
    const next = stepZoom(zoomed, 2, { x: 1600, y: 900, at: 3000 }, F, 16);
    expect(next.cx).toBeGreaterThan(zoomed.cx);
    expect(next.cx).toBeLessThan(1600);
  });

  it('keeps every intermediate view inside the frame, even for clicks outside it', () => {
    for (const click of [{ x: -50, y: -50, at: 0 }, { x: 5000, y: 5000, at: 0 }, { x: NaN, y: 3, at: 0 }]) {
      let s = initialZoom(F);
      for (let i = 0; i < 300; i++) {
        s = stepZoom(s, 2, click, F, 16);
        const r = zoomViewRect(F, { x: s.cx, y: s.cy }, s.zoom);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(F.width + 1e-9);
        expect(r.y + r.height).toBeLessThanOrEqual(F.height + 1e-9);
        expect(Number.isFinite(s.cx) && Number.isFinite(s.cy) && Number.isFinite(s.zoom)).toBe(true);
      }
    }
  });
});

describe('frameToCanvas', () => {
  it('maps through the zoomed view and the letterboxed destination', () => {
    const view = { x: 480, y: 270, width: 960, height: 540 };
    const dest = { x: 0, y: 140, width: 1280, height: 720 };
    expect(frameToCanvas({ x: 480, y: 270 }, view, dest)).toEqual({ x: 0, y: 140 });
    expect(frameToCanvas({ x: 960, y: 540 }, view, dest)).toEqual({ x: 640, y: 500 });
    expect(frameToCanvas({ x: 0, y: 0 }, view, dest).x).toBeLessThan(0); // outside the view: off-canvas, clipped by the caller
  });
  it('returns the destination origin for an empty view', () => {
    expect(frameToCanvas({ x: 5, y: 5 }, { x: 0, y: 0, width: 0, height: 0 }, { x: 7, y: 9, width: 10, height: 10 })).toEqual({ x: 7, y: 9 });
  });
});
