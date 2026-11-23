import { describe, expect, it } from 'vitest';
import {
  FOLLOW_DEAD_ZONE, focusCenterX, followCenter, framingNeedsCursor, framingRect, outputSize, PORTRAIT_ASPECT,
  portraitSize,
} from '../src/shared/framing';
import { QUALITY_PRESETS, qualityPreset } from '../src/shared/quality';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';

const p720 = qualityPreset('720p30');
const p1080 = qualityPreset('1080p30');
const screen = { width: 2560, height: 1440 };
const cam = { width: 640, height: 480 };

describe('portraitSize', () => {
  it('swaps the landscape cap per preset', () => {
    expect(portraitSize(p720)).toEqual({ width: 720, height: 1280 });
    expect(portraitSize(p1080)).toEqual({ width: 1080, height: 1920 });
  });
  it('is 9:16 and even for every preset', () => {
    for (const p of QUALITY_PRESETS) {
      const s = portraitSize(p);
      expect(s.width % 2).toBe(0);
      expect(s.height % 2).toBe(0);
      expect(s.width / s.height).toBeCloseTo(PORTRAIT_ASPECT, 3);
    }
  });
  it('rounds odd caps down to even', () => {
    expect(portraitSize({ maxWidth: 1281, maxHeight: 721 })).toEqual({ width: 720, height: 1280 });
  });
});

describe('outputSize', () => {
  it('pc scales the screen down to the preset', () => {
    expect(outputSize('pc', 'screen', screen, null, p1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('pc', 'screen', screen, null, p720)).toEqual({ width: 1280, height: 720 });
  });
  it('pc never upscales', () => {
    expect(outputSize('pc', 'screen', { width: 800, height: 600 }, null, p1080)).toEqual({ width: 800, height: 600 });
  });
  it('pc is null until the screen is ready', () => {
    expect(outputSize('pc', 'screen', null, null, p1080)).toBeNull();
  });
  it('mobile is fixed portrait regardless of source', () => {
    expect(outputSize('mobile', 'screen', screen, null, p1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('mobile', 'screen', null, null, p720)).toEqual({ width: 720, height: 1280 });
  });
  it('mobile camera-only is portrait too, with or without camera ready', () => {
    expect(outputSize('mobile', 'camera', null, cam, p720)).toEqual({ width: 720, height: 1280 });
    expect(outputSize('mobile', 'camera', screen, null, p1080)).toEqual({ width: 1080, height: 1920 });
  });
  it('pc camera-only follows the camera, falling back to 1280x720', () => {
    expect(outputSize('pc', 'camera', null, cam, p1080)).toEqual({ width: 640, height: 480 });
    expect(outputSize('pc', 'camera', null, null, p1080)).toEqual({ width: 1280, height: 720 });
  });
});

describe('focusCenterX', () => {
  const f = { width: 1920, height: 1080 };
  it('maps fraction to pixels and clamps', () => {
    expect(focusCenterX(f, 0.5)).toBe(960);
    expect(focusCenterX(f, 0)).toBe(0);
    expect(focusCenterX(f, 2)).toBe(1920);
    expect(focusCenterX(f, -1)).toBe(0);
  });
  it('falls back to centre for non-finite', () => {
    expect(focusCenterX(f, NaN)).toBe(960);
    expect(focusCenterX(f, Infinity)).toBe(960);
  });
});

describe('framingRect', () => {
  const view = { x: 0, y: 0, width: 1920, height: 1080 };
  const cropW = 1080 * PORTRAIT_ASPECT;
  it('full height with 9:16 width, centred on centerX', () => {
    const r = framingRect(view, PORTRAIT_ASPECT, 960);
    expect(r.height).toBe(1080);
    expect(r.width).toBeCloseTo(cropW);
    expect(r.x).toBeCloseTo(960 - cropW / 2);
    expect(r.y).toBe(0);
  });
  it('clamps to the left and right edges', () => {
    expect(framingRect(view, PORTRAIT_ASPECT, -500).x).toBe(0);
    const r = framingRect(view, PORTRAIT_ASPECT, 99999);
    expect(r.x + r.width).toBeCloseTo(1920);
  });
  it('respects a view with an offset origin', () => {
    const v = { x: 100, y: 50, width: 1000, height: 800 };
    const r = framingRect(v, PORTRAIT_ASPECT, 0);
    expect(r.x).toBe(100);
    expect(r.y).toBe(50);
    expect(r.height).toBe(800);
  });
  it('non-finite centre falls back to view centre', () => {
    const r = framingRect(view, PORTRAIT_ASPECT, NaN);
    expect(r.x + r.width / 2).toBeCloseTo(960);
  });
  it('cover-crops a view already narrower than the aspect', () => {
    const narrow = { x: 0, y: 0, width: 400, height: 1000 };
    const r = framingRect(narrow, PORTRAIT_ASPECT, 200);
    expect(r.width).toBe(400);
    expect(r.width / r.height).toBeCloseTo(PORTRAIT_ASPECT);
    expect(r.y).toBeGreaterThan(0);
  });
  it('returns the view for degenerate input', () => {
    expect(framingRect({ x: 0, y: 0, width: 0, height: 10 }, PORTRAIT_ASPECT, 0)).toEqual({ x: 0, y: 0, width: 0, height: 10 });
    expect(framingRect(view, 0, 100)).toEqual(view);
    expect(framingRect(view, NaN, 100)).toEqual(view);
  });
  it('camera 4:3 portrait crop stays inside the frame', () => {
    const r = framingRect({ x: 0, y: 0, ...cam }, PORTRAIT_ASPECT, 320);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(640);
    expect(r.width / r.height).toBeCloseTo(PORTRAIT_ASPECT);
  });
});

describe('followCenter', () => {
  const bounds = { min: 300, max: 1600 };
  const cw = 600;
  const dead = FOLLOW_DEAD_ZONE * cw;
  it('holds when the cursor is unknown', () => {
    expect(followCenter(900, null, cw, bounds, 16)).toBe(900);
    expect(followCenter(900, NaN, cw, bounds, 16)).toBe(900);
  });
  it('clamps the held centre into bounds', () => {
    expect(followCenter(0, null, cw, bounds, 16)).toBe(300);
    expect(followCenter(5000, null, cw, bounds, 16)).toBe(1600);
  });
  it('holds inside the dead zone', () => {
    expect(followCenter(900, 900 + dead - 1, cw, bounds, 16)).toBe(900);
    expect(followCenter(900, 900 - dead, cw, bounds, 16)).toBe(900);
  });
  it('moves toward the cursor outside the dead zone without overshooting the edge target', () => {
    const next = followCenter(900, 1400, cw, bounds, 16);
    expect(next).toBeGreaterThan(900);
    expect(next).toBeLessThanOrEqual(1400 - dead);
    const left = followCenter(900, 400, cw, bounds, 16);
    expect(left).toBeLessThan(900);
    expect(left).toBeGreaterThanOrEqual(400 + dead);
  });
  it('converges so the cursor ends within the dead zone', () => {
    let c = 900;
    for (let i = 0; i < 400; i++) c = followCenter(c, 1400, cw, bounds, 16);
    expect(c).toBeCloseTo(1400 - dead, 0);
  });
  it('does not move with zero dt and stays in bounds', () => {
    expect(followCenter(900, 1500, cw, bounds, 0)).toBe(900);
    let c = 900;
    for (let i = 0; i < 1000; i++) c = followCenter(c, 99999, cw, bounds, 50);
    expect(c).toBe(1600);
  });
});

describe('framingNeedsCursor', () => {
  it('only for mobile + follow + screen', () => {
    expect(framingNeedsCursor('mobile', 'follow', 'screen')).toBe(true);
    expect(framingNeedsCursor('mobile', 'follow', 'camera')).toBe(false);
    expect(framingNeedsCursor('mobile', 'fit', 'screen')).toBe(false);
    expect(framingNeedsCursor('mobile', 'focus', 'screen')).toBe(false);
    expect(framingNeedsCursor('pc', 'follow', 'screen')).toBe(false);
  });
});

describe('settings: outputFormat / mobile', () => {
  it('defaults', () => {
    const s = sanitizeSettings(undefined);
    expect(s.outputFormat).toBe('pc');
    expect(s.mobile).toEqual({ framing: 'follow', focusX: 0.5, cameraZoom: 0.3 });
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it('accepts valid values', () => {
    const s = sanitizeSettings({ outputFormat: 'mobile', mobile: { framing: 'focus', focusX: 0.25, cameraZoom: 0.3 } });
    expect(s.outputFormat).toBe('mobile');
    expect(s.mobile).toEqual({ framing: 'focus', focusX: 0.25, cameraZoom: 0.3 });
  });
  it('rejects invalid values', () => {
    const s = sanitizeSettings({ outputFormat: 'tablet', mobile: { framing: 'zoom', focusX: 'x' } });
    expect(s.outputFormat).toBe('pc');
    expect(s.mobile).toEqual({ framing: 'follow', focusX: 0.5, cameraZoom: 0.3 });
  });
  it('clamps focusX and handles NaN / bad mobile object', () => {
    expect(sanitizeSettings({ mobile: { focusX: 7 } }).mobile.focusX).toBe(1);
    expect(sanitizeSettings({ mobile: { focusX: -7 } }).mobile.focusX).toBe(0);
    expect(sanitizeSettings({ mobile: { focusX: NaN } }).mobile.focusX).toBe(0.5);
    expect(sanitizeSettings({ mobile: 'oops' }).mobile).toEqual(DEFAULT_SETTINGS.mobile);
    expect(sanitizeSettings({ mobile: [1] }).mobile).toEqual(DEFAULT_SETTINGS.mobile);
  });
  it('is idempotent and does not share the default mobile object', () => {
    const s = sanitizeSettings({ outputFormat: 'mobile', mobile: { framing: 'fit', focusX: 0.9 } });
    expect(sanitizeSettings(s)).toEqual(s);
    sanitizeSettings({}).mobile.focusX = 0.1;
    expect(DEFAULT_SETTINGS.mobile.focusX).toBe(0.5);
  });
});

describe('edge cases (requested by coder)', () => {
  it('framingRect returns the view for zero-size views', () => {
    const z = { x: 5, y: 5, width: 0, height: 0 };
    expect(framingRect(z, PORTRAIT_ASPECT, 10)).toEqual(z);
  });
  it('framingRect with NaN view size returns finite numbers (guard NaN dims)', () => {
    const r = framingRect({ x: 0, y: 0, width: NaN, height: 1080 }, PORTRAIT_ASPECT, 100);
    expect(Object.values(r).every((v) => Number.isFinite(v))).toBe(true);
  });
  it('followCenter with min>max bounds stays finite', () => {
    const c = followCenter(900, 1200, 600, { min: 1600, max: 300 }, 16);
    expect(Number.isFinite(c)).toBe(true);
  });
});

describe('settings: mobile.cameraZoom', () => {
  it('defaults to 0.3 (old files without it too) and is clamped', () => {
    expect(sanitizeSettings({}).mobile.cameraZoom).toBe(0.3);
    expect(sanitizeSettings({ mobile: { framing: 'focus' } }).mobile.cameraZoom).toBe(0.3);
    expect(sanitizeSettings({ mobile: { cameraZoom: 0.8 } }).mobile.cameraZoom).toBe(0.8);
    expect(sanitizeSettings({ mobile: { cameraZoom: 7 } }).mobile.cameraZoom).toBe(1);
    expect(sanitizeSettings({ mobile: { cameraZoom: -1 } }).mobile.cameraZoom).toBe(0);
    expect(sanitizeSettings({ mobile: { cameraZoom: 'x' } }).mobile.cameraZoom).toBe(0.3);
  });
});
