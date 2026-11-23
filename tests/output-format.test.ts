import { describe, expect, it } from 'vitest';
import {
  focusCenterX, followCenter, framingNeedsCursor, framingRect, outputSize, portraitSize,
} from '../src/shared/framing';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';

const P720 = { maxWidth: 1280, maxHeight: 720 };
const P1080 = { maxWidth: 1920, maxHeight: 1080 };

describe('portraitSize / outputSize', () => {
  it('swaps the preset dimensions', () => {
    expect(portraitSize(P720)).toEqual({ width: 720, height: 1280 });
    expect(portraitSize(P1080)).toEqual({ width: 1080, height: 1920 });
  });
  it('mobile is portrait whatever the source', () => {
    for (const mode of ['screen', 'camera'] as const) {
      expect(outputSize('mobile', mode, { width: 3840, height: 2160 }, { width: 640, height: 480 }, P720))
        .toEqual({ width: 720, height: 1280 });
    }
    expect(outputSize('mobile', 'screen', null, null, P720)).toEqual({ width: 720, height: 1280 });
  });
  it('pc keeps the source aspect, capped, and waits for a source', () => {
    expect(outputSize('pc', 'screen', { width: 2560, height: 1440 }, null, P720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize('pc', 'screen', null, null, P720)).toBeNull();
  });
});

describe('framingRect', () => {
  const view = { x: 0, y: 0, width: 1920, height: 1080 };
  const w = 1080 * (9 / 16);
  it('is a full-height 9:16 crop centred on centerX', () => {
    const r = framingRect(view, 9 / 16, 960);
    expect(r.height).toBe(1080);
    expect(r.width).toBeCloseTo(w);
    expect(r.x + r.width / 2).toBeCloseTo(960);
  });
  it('clamps to the view edges', () => {
    expect(framingRect(view, 9 / 16, -500).x).toBe(0);
    const r = framingRect(view, 9 / 16, 99999);
    expect(r.x + r.width).toBeCloseTo(1920);
  });
  it('works inside a zoomed view', () => {
    const z = { x: 400, y: 200, width: 960, height: 540 };
    const r = framingRect(z, 9 / 16, 0);
    expect(r.x).toBe(400);
    expect(r.y).toBe(200);
    expect(r.height).toBe(540);
  });
  it('cover-crops a view narrower than the aspect', () => {
    const r = framingRect({ x: 0, y: 0, width: 300, height: 1000 }, 9 / 16, 0);
    expect(r.width / r.height).toBeCloseTo(9 / 16);
    expect(r.width).toBe(300);
  });
});

describe('followCenter / focusCenterX', () => {
  const bounds = { min: 100, max: 1800 };
  it('holds while the cursor is in the dead zone', () => {
    expect(followCenter(900, 950, 600, bounds, 16)).toBe(900);
  });
  it('moves toward a cursor outside the dead zone, never past the bounds', () => {
    const next = followCenter(900, 1700, 600, bounds, 100);
    expect(next).toBeGreaterThan(900);
    expect(next).toBeLessThanOrEqual(1800);
    expect(followCenter(1790, 99999, 600, bounds, 5000)).toBeLessThanOrEqual(1800);
  });
  it('holds (clamped) without cursor data', () => {
    expect(followCenter(900, null, 600, bounds, 16)).toBe(900);
    expect(followCenter(5, null, 600, bounds, 16)).toBe(100);
  });
  it('focus centre maps fraction to frame px, tolerating junk', () => {
    expect(focusCenterX({ width: 1000, height: 500 }, 0.25)).toBe(250);
    expect(focusCenterX({ width: 1000, height: 500 }, NaN)).toBe(500);
    expect(focusCenterX({ width: 1000, height: 500 }, 7)).toBe(1000);
  });
  it('needs the cursor only for mobile follow on screen', () => {
    expect(framingNeedsCursor('mobile', 'follow', 'screen')).toBe(true);
    expect(framingNeedsCursor('mobile', 'follow', 'camera')).toBe(false);
    expect(framingNeedsCursor('pc', 'follow', 'screen')).toBe(false);
    expect(framingNeedsCursor('mobile', 'focus', 'screen')).toBe(false);
  });
});

describe('settings sanitising', () => {
  it('old files get the defaults', () => {
    const s = sanitizeSettings({ captureMode: 'camera' });
    expect(s.outputFormat).toBe('pc');
    expect(s.mobile).toEqual({ framing: 'follow', focusX: 0.5, cameraZoom: 0.3 });
    expect(DEFAULT_SETTINGS.outputFormat).toBe('pc');
  });
  it('keeps valid values and rejects junk', () => {
    const ok = sanitizeSettings({ outputFormat: 'mobile', mobile: { framing: 'focus', focusX: 0.2 } });
    expect(ok.outputFormat).toBe('mobile');
    expect(ok.mobile).toEqual({ framing: 'focus', focusX: 0.2, cameraZoom: 0.3 });
    const bad = sanitizeSettings({ outputFormat: 'tv', mobile: { framing: 'zoom', focusX: 9 } });
    expect(bad.outputFormat).toBe('pc');
    expect(bad.mobile.framing).toBe('follow');
    expect(bad.mobile.focusX).toBe(1);
    expect(sanitizeSettings({ mobile: 'x' }).mobile.focusX).toBe(0.5);
  });
});
