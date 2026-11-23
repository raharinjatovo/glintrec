import { describe, expect, it } from 'vitest';
import {
  detectModeChange, easeInOut, MODE_TRANSITION_MS, MODE_TRANSITION_START_SCALE,
  transitionDone, transitionFrame, transitionProgress, lerp, lerpRect, bubbleRadius, morphFrame,
} from '../src/shared/mode-transition';
import { ROUNDED_RADIUS_RATIO } from '../src/shared/overlay-layout';

describe('rect/radius interpolation', () => {
  it('lerp and lerpRect', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(lerpRect({ x: 0, y: 0, width: 100, height: 50 }, { x: 20, y: 10, width: 20, height: 10 }, 0.5))
      .toEqual({ x: 10, y: 5, width: 60, height: 30 });
  });
  it('bubbleRadius per shape', () => {
    expect(bubbleRadius('circle', { x: 0, y: 0, width: 100, height: 100 })).toBe(50);
    expect(bubbleRadius('rounded', { x: 0, y: 0, width: 160, height: 90 })).toBeCloseTo(90 * ROUNDED_RADIUS_RATIO);
  });
});

describe('morphFrame', () => {
  const canvas = { width: 1280, height: 720 };
  const bubble = { x: 1000, y: 500, width: 200, height: 200 };
  it('shrink starts full-canvas and ends exactly on the bubble', () => {
    const a = morphFrame(0, true, canvas, bubble, 100);
    expect(a.rect).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(a.radius).toBe(0);
    expect(a.screenAlpha).toBe(0);
    const b = morphFrame(1, true, canvas, bubble, 100);
    expect(b.rect).toEqual(bubble);
    expect(b.radius).toBe(100);
    expect(b.screenAlpha).toBe(1);
    expect(b.screenScale).toBe(1);
    expect(b.src.width / b.src.height).toBeCloseTo(1);
  });
  it('grow is the exact reverse', () => {
    expect(morphFrame(0, false, canvas, bubble, 100).rect).toEqual(bubble);
    expect(morphFrame(1, false, canvas, bubble, 100).rect).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    const mid = morphFrame(0.4, true, canvas, bubble, 100);
    const rev = morphFrame(0.6, false, canvas, bubble, 100);
    expect(rev.rect.x).toBeCloseTo(mid.rect.x);
    expect(rev.radius).toBeCloseTo(mid.radius);
  });
  it('radius never exceeds half the shorter side', () => {
    for (let p = 0; p <= 1; p += 0.1) {
      const f = morphFrame(p, true, canvas, bubble, 100);
      expect(f.radius).toBeLessThanOrEqual(Math.min(f.rect.width, f.rect.height) / 2 + 1e-9);
    }
  });
});

describe('detectModeChange', () => {
  it('detects a switch in both directions', () => {
    expect(detectModeChange('screen', 'camera', true)).toBe(true);
    expect(detectModeChange('camera', 'screen', true)).toBe(true);
  });
  it('ignores same mode, no previous mode, or no previous frame', () => {
    expect(detectModeChange('screen', 'screen', true)).toBe(false);
    expect(detectModeChange(null, 'camera', true)).toBe(false);
    expect(detectModeChange('screen', 'camera', false)).toBe(false);
  });
});

describe('transitionProgress', () => {
  it('runs 0..1 over the duration and clamps', () => {
    expect(transitionProgress(1000, 1000)).toBe(0);
    expect(transitionProgress(1000, 1000 + MODE_TRANSITION_MS / 2)).toBeCloseTo(0.5);
    expect(transitionProgress(1000, 1000 + MODE_TRANSITION_MS * 3)).toBe(1);
    expect(transitionProgress(1000, 500)).toBe(0);
  });
  it('finishes on bad input', () => {
    expect(transitionProgress(NaN, 10)).toBe(1);
    expect(transitionProgress(0, 10, 0)).toBe(1);
  });
  it('transitionDone', () => {
    expect(transitionDone(0, MODE_TRANSITION_MS - 1)).toBe(false);
    expect(transitionDone(0, MODE_TRANSITION_MS)).toBe(true);
  });
});

describe('easing and frame', () => {
  it('easeInOut is monotonic with fixed endpoints', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25)).toBeLessThan(easeInOut(0.75));
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(NaN)).toBe(0);
  });
  it('transitionFrame goes from transparent/zoomed-out to opaque/1', () => {
    expect(transitionFrame(0)).toEqual({ alpha: 0, scale: MODE_TRANSITION_START_SCALE });
    expect(transitionFrame(1)).toEqual({ alpha: 1, scale: 1 });
  });
});
