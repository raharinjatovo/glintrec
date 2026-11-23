import { describe, expect, it } from 'vitest';
import { regionFromView, sameRegion, sanitizeCaptureRegion } from '../src/shared/capture-region';

const frame = { width: 1920, height: 1080 };

describe('regionFromView', () => {
  it('returns null for the full frame', () => {
    expect(regionFromView({ x: 0, y: 0, width: 1920, height: 1080 }, frame)).toBeNull();
  });

  it('describes a 2x zoom', () => {
    const r = regionFromView({ x: 480, y: 270, width: 960, height: 540 }, frame)!;
    expect(r.x).toBeCloseTo(0.25);
    expect(r.y).toBeCloseTo(0.25);
    expect(r.w).toBeCloseTo(0.5);
    expect(r.h).toBeCloseTo(0.5);
  });

  it('describes a 9:16 crop of a 16:9 frame', () => {
    const w = 1080 * (9 / 16);
    const r = regionFromView({ x: 600, y: 0, width: w, height: 1080 }, frame)!;
    expect(r.w).toBeCloseTo(w / 1920);
    expect(r.h).toBeCloseTo(1);
    expect(r.x).toBeCloseTo(600 / 1920);
    expect(r.y).toBe(0);
  });

  it('clamps a view that sticks out of the frame', () => {
    const r = regionFromView({ x: 1500, y: -50, width: 960, height: 540 }, frame)!;
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y).toBe(0);
  });

  it('rejects bad input', () => {
    expect(regionFromView({ x: 0, y: 0, width: 100, height: 100 }, { width: 0, height: 0 })).toBeNull();
    expect(regionFromView({ x: NaN, y: 0, width: 100, height: 100 }, frame)).toBeNull();
    expect(regionFromView({ x: 0, y: 0, width: 0, height: 100 }, frame)).toBeNull();
  });
});

describe('sameRegion', () => {
  const a = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  it('compares nulls and tolerance', () => {
    expect(sameRegion(null, null)).toBe(true);
    expect(sameRegion(a, null)).toBe(false);
    expect(sameRegion(a, { ...a, x: 0.1005 })).toBe(true);
    expect(sameRegion(a, { ...a, x: 0.2 })).toBe(false);
  });
});

describe('sanitizeCaptureRegion', () => {
  it('accepts and clamps valid regions', () => {
    expect(sanitizeCaptureRegion({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 })).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    expect(sanitizeCaptureRegion({ x: 0.8, y: 0, w: 0.5, h: 0.5 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });

  it('returns null for garbage', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { x: '0', y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: NaN, h: 0.5 },
      { x: 0, y: 0, w: 0, h: 0.5 }, { x: 0, y: 0, w: 2, h: 0.5 }, { x: -1, y: 0, w: 0.5, h: 0.5 }]) {
      expect(sanitizeCaptureRegion(bad)).toBeNull();
    }
  });
});
