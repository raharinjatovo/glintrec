import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';
import {
  computeOverlayRect, coverCrop, fitContain, overlayAspect, scaleToMax,
} from '../src/shared/overlay-layout';
import {
  createElapsedClock, formatElapsed, initialState, reduce, type RecState,
} from '../src/shared/recorder-machine';
import { timestampName } from '../src/shared/format';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps and validates', () => {
    const s = sanitizeSettings({
      overlay: { sizePercent: 999, corner: 'nope', shape: 'rounded' },
      background: { blurRadius: 0, color: 'red', mode: 'blur' },
    });
    expect(s.overlay.sizePercent).toBe(40);
    expect(s.overlay.corner).toBe('bottom-right');
    expect(s.overlay.shape).toBe('rounded');
    expect(s.background.blurRadius).toBe(2);
    expect(s.background.color).toBe('#1e90ff');
    expect(s.background.mode).toBe('blur');
    expect(s.version).toBe(1);
  });
  it('defaults captureMode to screen', () => {
    expect(DEFAULT_SETTINGS.captureMode).toBe('screen');
    expect(sanitizeSettings({}).captureMode).toBe('screen');
  });
  it('accepts captureMode camera', () => {
    expect(sanitizeSettings({ captureMode: 'camera' }).captureMode).toBe('camera');
    expect(sanitizeSettings({ captureMode: 'screen' }).captureMode).toBe('screen');
  });
  it('falls back to screen for garbage captureMode', () => {
    for (const v of [42, 'foo', null, undefined, {}, [], true]) {
      expect(sanitizeSettings({ captureMode: v }).captureMode).toBe('screen');
    }
  });
});

describe('overlay layout', () => {
  const canvas = { width: 1000, height: 600 };
  it('places corners', () => {
    const o = { sizePercent: 20, marginPercent: 2, aspect: 1 };
    expect(computeOverlayRect(canvas, { ...o, corner: 'top-left' })).toEqual({ x: 20, y: 20, width: 200, height: 200 });
    expect(computeOverlayRect(canvas, { ...o, corner: 'bottom-right' })).toEqual({ x: 780, y: 380, width: 200, height: 200 });
  });
  it('clamps size and uses aspect', () => {
    const r = computeOverlayRect(canvas, { corner: 'top-right', sizePercent: 90, marginPercent: 0, aspect: 2 });
    expect(r.width).toBe(400);
    expect(r.height).toBe(200);
  });
  it('aspect by shape', () => {
    expect(overlayAspect('circle')).toBe(1);
    expect(overlayAspect('rounded')).toBeCloseTo(16 / 9);
  });
  it('coverCrop / fitContain / scaleToMax', () => {
    expect(coverCrop({ width: 200, height: 100 }, { width: 100, height: 100 })).toEqual({ x: 50, y: 0, width: 100, height: 100 });
    expect(fitContain({ width: 100, height: 50 }, { width: 200, height: 200 })).toEqual({ x: 0, y: 50, width: 200, height: 100 });
    expect(scaleToMax({ width: 3840, height: 2160 }, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(scaleToMax({ width: 801, height: 601 }, 1920, 1080)).toEqual({ width: 800, height: 600 });
  });
});

describe('recorder machine', () => {
  it('runs countdown then recording', () => {
    let s: RecState = reduce(initialState(), { type: 'START' });
    expect(s).toEqual({ phase: 'countdown', remaining: 3 });
    s = reduce(s, { type: 'TICK' });
    s = reduce(s, { type: 'TICK' });
    expect(s).toEqual({ phase: 'countdown', remaining: 1 });
    s = reduce(s, { type: 'TICK' });
    expect(s).toEqual({ phase: 'recording' });
    s = reduce(s, { type: 'PAUSE' });
    s = reduce(s, { type: 'RESUME' });
    s = reduce(s, { type: 'STOP' });
    expect(s.phase).toBe('stopping');
    expect(reduce(s, { type: 'STOPPED' }).phase).toBe('idle');
  });
  it('ignores invalid events', () => {
    const s = initialState();
    expect(reduce(s, { type: 'PAUSE' })).toBe(s);
    expect(reduce(s, { type: 'STOP' })).toBe(s);
  });
  it('clock accumulates only while running', () => {
    let t = 0;
    const c = createElapsedClock(() => t);
    c.start(); t = 1000; c.pause(); t = 5000;
    expect(c.elapsedMs()).toBe(1000);
    c.resume(); t = 5500;
    expect(c.elapsedMs()).toBe(1500);
  });
  it('formats', () => {
    expect(formatElapsed(65_900)).toBe('01:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('00:00');
  });
  it('timestampName', () => {
    expect(timestampName(new Date(2026, 9, 29, 14, 5, 33))).toBe('recording-2026-10-29-14-05-33');
  });
});
