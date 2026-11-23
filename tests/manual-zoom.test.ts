import { describe, expect, it } from 'vitest';
import { createEffects } from '../src/renderer/effects';
import { inputRequestFor } from '../src/renderer/input-effects';
import { DEFAULT_HOTKEYS, findHotkeyConflict, sanitizeHotkeys, validateAccelerator } from '../src/shared/hotkeys';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';
import { clampManualZoom, stepManualZoom, zoomViewRect } from '../src/shared/zoom';

const display = { id: '1', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
const frame = { width: 1920, height: 1080 };
const fxOff = () => ({ ...DEFAULT_SETTINGS.effects, autoZoom: 1 as const });

describe('manual zoom with auto-zoom off', () => {
  it('zooms in even when the display is only approximate, and reports no view change without a display', () => {
    const e = createEffects(fxOff);
    e.setDisplay(display, true);
    e.push({ t: 'cursor', x: 100, y: 100 });
    e.zoomBy('zoomIn');
    let v = e.beginFrame(0, frame);
    for (let t = 16; t < 2000; t += 16) v = e.beginFrame(t, frame);
    expect(v.width).toBeLessThan(frame.width);
    const none = createEffects(fxOff);
    none.zoomBy('zoomIn');
    expect(none.beginFrame(0, frame).width).toBe(frame.width);
  });
});

describe('manual zoom steps', () => {
  it('steps by 0.5 and clamps to 1..4', () => {
    expect(stepManualZoom(1, 'zoomIn')).toBe(1.5);
    expect(stepManualZoom(4, 'zoomIn')).toBe(4);
    expect(stepManualZoom(1, 'zoomOut')).toBe(1);
    expect(stepManualZoom(2.5, 'zoomOut')).toBe(2);
    expect(stepManualZoom(3, 'zoomReset')).toBe(1);
    expect(clampManualZoom(NaN)).toBe(1);
    expect(clampManualZoom(9)).toBe(4);
    expect(clampManualZoom(1.7)).toBe(1.5);
  });
});

describe('zoom hotkeys', () => {
  it('have valid, distinct defaults', () => {
    for (const a of ['zoomIn', 'zoomOut', 'zoomReset'] as const) {
      expect(validateAccelerator(DEFAULT_HOTKEYS[a])).toBe(DEFAULT_HOTKEYS[a]);
    }
    expect(new Set(Object.values(DEFAULT_HOTKEYS)).size).toBe(Object.keys(DEFAULT_HOTKEYS).length);
  });
  it('migrates saved hotkeys lacking the new actions and detects conflicts', () => {
    const h = sanitizeSettings({ hotkeys: { toggle: 'F5' } }).hotkeys;
    expect(h.zoomIn).toBe(DEFAULT_HOTKEYS.zoomIn);
    expect(h.zoomReset).toBe(DEFAULT_HOTKEYS.zoomReset);
    expect(sanitizeHotkeys({ zoomOut: 'Ctrl+Alt+Home' }).zoomOut).toBe('Control+Alt+Home');
    expect(sanitizeHotkeys({ zoomOut: 'Ctrl+Alt+Home' }).zoomReset).toBe('');
    expect(findHotkeyConflict(DEFAULT_HOTKEYS, 'zoomIn', DEFAULT_HOTKEYS.zoomReset)).toBe('zoomReset');
  });
});

describe('effects manual zoom view', () => {
  it('zooms to the level centred on the cursor, inside the frame, then resets', () => {
    const e = createEffects(fxOff);
    e.setDisplay(display, true);
    e.push({ t: 'cursor', x: 960, y: 540 }, 0);
    expect(e.zoomBy('zoomIn')).toBe(1.5);
    expect(e.zoomBy('zoomIn')).toBe(2);
    let v = e.beginFrame(1000, frame);
    for (let t = 1016; t < 4000; t += 16) v = e.beginFrame(t, frame);
    expect(v.width).toBeCloseTo(960, 0);
    e.push({ t: 'cursor', x: 1919, y: 1079 }, 0);
    for (let t = 4000; t < 9000; t += 16) v = e.beginFrame(t, frame);
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(v.x + v.width).toBeLessThanOrEqual(1920 + 1e-6);
    expect(v.y + v.height).toBeLessThanOrEqual(1080 + 1e-6);
    e.zoomBy('zoomReset');
    for (let t = 9000; t < 14000; t += 16) v = e.beginFrame(t, frame);
    expect(v).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('zoomViewRect level 2 near a corner stays inside the frame', () => {
    expect(zoomViewRect(frame, { x: 100, y: 100 }, 2)).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });

  it('requests cursor events for screen mode even with all effects off', () => {
    const s = sanitizeSettings({ captureMode: 'screen' });
    s.effects = { ...s.effects, cursorHighlight: false, clickRipples: false, keystrokes: false, autoZoom: 1 };
    expect(inputRequestFor(s)?.cursor).toBe(true);
    expect(inputRequestFor({ ...s, captureMode: 'camera' })).toBeNull();
  });
});
