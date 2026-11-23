import { describe, expect, it } from 'vitest';
import {
  deriveZoomHud, formatZoomFactor, sameZoomHud, sanitizeZoomHudUpdate, zoomHudLabel, zoomHudRect, zoomHudView,
} from '../src/shared/zoom-hud';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';
import { createEffects } from '../src/renderer/effects';

describe('sanitizeZoomHudUpdate', () => {
  it('accepts valid updates and defaults flash to false', () => {
    expect(sanitizeZoomHudUpdate({ factor: 2.5, mode: 'manual' })).toEqual({ factor: 2.5, mode: 'manual', flash: false });
    expect(sanitizeZoomHudUpdate({ factor: 1, mode: 'none', flash: true })).toEqual({ factor: 1, mode: 'none', flash: true });
    expect(sanitizeZoomHudUpdate({ factor: 8, mode: 'auto', flash: 'yes' })?.flash).toBe(false);
  });
  it('rejects bad factors and modes', () => {
    for (const factor of [NaN, Infinity, -1, 0, 0.5, 8.5, '2', null, undefined]) expect(sanitizeZoomHudUpdate({ factor, mode: 'auto' })).toBeNull();
    for (const mode of ['', 'AUTO', 'x', 1, null, undefined]) expect(sanitizeZoomHudUpdate({ factor: 2, mode })).toBeNull();
    for (const raw of [null, 5, 'x', [], undefined]) expect(sanitizeZoomHudUpdate(raw)).toBeNull();
  });
  it('clamps rounding noise at the edges', () => {
    expect(sanitizeZoomHudUpdate({ factor: 1 - 1e-9, mode: 'none' })?.factor).toBe(1);
  });
});

describe('deriveZoomHud and view', () => {
  it('manual level wins, then auto, else none', () => {
    expect(deriveZoomHud(1, 1, false)).toBe('none');
    expect(deriveZoomHud(1.01, 1, true)).toBe('none');
    expect(deriveZoomHud(1, 2, true)).toBe('manual');
    expect(deriveZoomHud(1.8, 1, true)).toBe('auto');
    expect(deriveZoomHud(1.8, 1.5, true)).toBe('manual');
    expect(deriveZoomHud(1.5, 1, false)).toBe('manual'); // easing out after a manual reset
    expect(deriveZoomHud(NaN, 1, true)).toBe('none');
  });
  it('labels are French and the text has one decimal', () => {
    expect(zoomHudLabel('none')).toBe('Pas de zoom');
    expect(zoomHudLabel('manual')).toBe('Zoom manuel');
    expect(zoomHudLabel('auto')).toBe('Zoom auto');
    expect(formatZoomFactor(1)).toBe('1.0\u00d7');
    expect(formatZoomFactor(2.46)).toBe('2.5\u00d7');
    expect(formatZoomFactor(NaN)).toBe('1.0\u00d7');
  });
  it('bar fraction spans 1x to 4x', () => {
    expect(zoomHudView({ factor: 1, mode: 'none' }).fraction).toBe(0);
    expect(zoomHudView({ factor: 2.5, mode: 'manual' }).fraction).toBeCloseTo(0.5);
    expect(zoomHudView({ factor: 6, mode: 'auto' }).fraction).toBe(1);
  });
  it('sameZoomHud ignores sub-0.05 jitter but not mode changes', () => {
    expect(sameZoomHud(null, { factor: 1, mode: 'none' })).toBe(false);
    expect(sameZoomHud({ factor: 2, mode: 'auto' }, { factor: 2.01, mode: 'auto' })).toBe(true);
    expect(sameZoomHud({ factor: 2, mode: 'auto' }, { factor: 2.1, mode: 'auto' })).toBe(false);
    expect(sameZoomHud({ factor: 2, mode: 'auto' }, { factor: 2, mode: 'manual' })).toBe(false);
  });
});

describe('zoomHudRect', () => {
  const area = { x: 1920, y: 0, width: 1920, height: 1080 };
  it('sits in the corner with a margin, on the given display', () => {
    expect(zoomHudRect(area, { width: 156, height: 44 }, 24)).toEqual({ x: 1920 + 1920 - 156 - 24, y: 1080 - 44 - 24, width: 156, height: 44 });
    expect(zoomHudRect(area, { width: 156, height: 44 }, 24, 'top-left')).toEqual({ x: 1944, y: 24, width: 156, height: 44 });
  });
});

describe('zoomHud setting', () => {
  it('defaults to on and old settings files (no key) migrate to on', () => {
    expect(DEFAULT_SETTINGS.effects.zoomHud).toBe(true);
    expect(sanitizeSettings({ effects: { cursorHighlight: true, autoZoom: 2 } }).effects.zoomHud).toBe(true);
    expect(sanitizeSettings({}).effects.zoomHud).toBe(true);
  });
  it('keeps an explicit false and ignores non-booleans', () => {
    expect(sanitizeSettings({ effects: { zoomHud: false } }).effects.zoomHud).toBe(false);
    expect(sanitizeSettings({ effects: { zoomHud: 0 } }).effects.zoomHud).toBe(true);
    expect(sanitizeSettings({ effects: { zoomHud: 'false' } }).effects.zoomHud).toBe(true);
  });
});

describe('effects.zoomFactor', () => {
  it('reports the smoothed factor, not the target', () => {
    const e = createEffects(() => ({ ...DEFAULT_SETTINGS.effects }));
    const frame = { width: 1920, height: 1080 };
    e.setDisplay({ id: '1', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 });
    expect(e.zoomFactor()).toBe(1);
    e.zoomBy('zoomIn'); e.zoomBy('zoomIn'); // target 2
    e.beginFrame(1000, frame);
    e.beginFrame(1100, frame);
    const mid = e.zoomFactor();
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
    for (let t = 1200; t < 6000; t += 16) e.beginFrame(t, frame);
    expect(e.zoomFactor()).toBe(2);
    e.reset();
    expect(e.zoomFactor()).toBe(1);
  });
});
