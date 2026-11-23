import { describe, expect, it } from 'vitest';
import { cameraMobileRects } from '../src/shared/framing';

const frame = { width: 1920, height: 1080 };
const canvas = { width: 720, height: 1280 };
const cropW = 1080 * (720 / 1280); // 607.5

describe('cameraMobileRects', () => {
  it('focus: full-height 9:16 window centred at focusX', () => {
    const r = cameraMobileRects(frame, canvas, 'focus', 0.5, false);
    expect(r.src.height).toBe(1080);
    expect(r.src.width).toBeCloseTo(cropW);
    expect(r.src.x + r.src.width / 2).toBeCloseTo(960);
    expect(r.dest).toEqual({ x: 0, y: 0, width: 720, height: 1280 });
    expect(r.letterboxed).toBe(false);
  });
  it('clamps to the frame edges', () => {
    expect(cameraMobileRects(frame, canvas, 'focus', 0, false).src.x).toBe(0);
    const r = cameraMobileRects(frame, canvas, 'focus', 1, false);
    expect(r.src.x + r.src.width).toBeCloseTo(1920);
  });
  it('follow behaves like focus', () => {
    expect(cameraMobileRects(frame, canvas, 'follow', 0.2, false)).toEqual(cameraMobileRects(frame, canvas, 'focus', 0.2, false));
  });
  it('mirror: focusX is the part of the picture as seen (raw crop moves to the opposite side)', () => {
    const plain = cameraMobileRects(frame, canvas, 'focus', 0.1, false);
    const mir = cameraMobileRects(frame, canvas, 'focus', 0.1, true);
    expect(plain.src.x).toBe(0);
    expect(mir.src.x + mir.src.width).toBeCloseTo(1920); // seen left = raw right
    expect(cameraMobileRects(frame, canvas, 'focus', 0.5, true).src.x).toBeCloseTo(plain.src.x + (960 - cropW / 2));
  });
  it('fit: whole frame letterboxed in the middle', () => {
    const r = cameraMobileRects(frame, canvas, 'fit', 0.9, true);
    expect(r.src).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(r.dest.width).toBe(720);
    expect(r.dest.height).toBeCloseTo(405);
    expect(r.dest.y).toBeCloseTo((1280 - 405) / 2);
    expect(r.letterboxed).toBe(true);
  });
  it('portrait camera narrower than the aspect is cover-cropped, not out of bounds', () => {
    const r = cameraMobileRects({ width: 400, height: 1000 }, canvas, 'focus', 0.5, false);
    expect(r.src.x).toBeGreaterThanOrEqual(0);
    expect(r.src.x + r.src.width).toBeLessThanOrEqual(400);
    expect(r.src.width / r.src.height).toBeCloseTo(720 / 1280);
  });
  it('degenerate sizes and NaN focus yield safe results', () => {
    expect(cameraMobileRects({ width: 0, height: 0 }, canvas, 'focus', 0.5, false).dest.width).toBe(0);
    expect(cameraMobileRects(frame, { width: 0, height: 0 }, 'fit', 0.5, false).dest.width).toBe(0);
    const r = cameraMobileRects(frame, canvas, 'focus', NaN, false);
    expect(r.src.x + r.src.width / 2).toBeCloseTo(960);
  });

  describe('cameraZoom', () => {
    it('zoom 0 = whole frame fitted to the width (like fit)', () => {
      const r = cameraMobileRects(frame, canvas, 'focus', 0.5, false, 0);
      expect(r.src).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
      expect(r.dest.width).toBe(720);
      expect(r.dest.height).toBeCloseTo(405);
      expect(r.dest.y).toBeCloseTo((1280 - 405) / 2);
      expect(r.letterboxed).toBe(true);
    });
    it('zoom 1 = the tight crop, same as the default', () => {
      expect(cameraMobileRects(frame, canvas, 'focus', 0.3, false, 1)).toEqual(cameraMobileRects(frame, canvas, 'focus', 0.3, false));
      expect(cameraMobileRects(frame, canvas, 'focus', 0.3, false, 1).letterboxed).toBe(false);
    });
    it('zoom 0.3: wider window than the tight crop, centred vertically with bars', () => {
      const wc = 720 + (1280 * (16 / 9) - 720) * 0.3;
      const r = cameraMobileRects(frame, canvas, 'focus', 0.5, false, 0.3);
      expect(r.src.height).toBe(1080);
      expect(r.src.width).toBeCloseTo((1920 * 720) / wc);
      expect(r.src.width).toBeGreaterThan(cropW);
      expect(r.src.x + r.src.width / 2).toBeCloseTo(960);
      expect(r.dest.width).toBe(720);
      expect(r.dest.height).toBeCloseTo(wc / (16 / 9));
      expect(r.dest.y).toBeCloseTo((1280 - r.dest.height) / 2);
      expect(r.letterboxed).toBe(true);
    });
    it('clamps the window inside the frame and keeps the mirror sign', () => {
      const l = cameraMobileRects(frame, canvas, 'focus', 0, false, 0.3);
      expect(l.src.x).toBe(0);
      const rr = cameraMobileRects(frame, canvas, 'focus', 1, false, 0.3);
      expect(rr.src.x + rr.src.width).toBeCloseTo(1920);
      const m = cameraMobileRects(frame, canvas, 'focus', 0, true, 0.3);
      expect(m.src.x + m.src.width).toBeCloseTo(1920);
    });
    it('fit ignores zoom; out-of-range / NaN zoom is clamped', () => {
      expect(cameraMobileRects(frame, canvas, 'fit', 0.5, false, 1)).toEqual(cameraMobileRects(frame, canvas, 'fit', 0.5, false, 0));
      expect(cameraMobileRects(frame, canvas, 'focus', 0.5, false, -5)).toEqual(cameraMobileRects(frame, canvas, 'focus', 0.5, false, 0));
      expect(cameraMobileRects(frame, canvas, 'focus', 0.5, false, 9)).toEqual(cameraMobileRects(frame, canvas, 'focus', 0.5, false, 1));
      expect(cameraMobileRects(frame, canvas, 'focus', 0.5, false, NaN)).toEqual(cameraMobileRects(frame, canvas, 'focus', 0.5, false, 1));
    });
    it('degenerate sizes stay empty', () => {
      expect(cameraMobileRects({ width: 0, height: 0 }, canvas, 'focus', 0.5, false, 0.3).dest.width).toBe(0);
      expect(cameraMobileRects(frame, { width: 0, height: 0 }, 'focus', 0.5, false, 0.3).dest.width).toBe(0);
    });
  });
});
