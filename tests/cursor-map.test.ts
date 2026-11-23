import { describe, expect, it } from 'vitest';
import {
  framePxPerDip, mapCursorToFrame, resolveDisplayForSource, sanitizeDisplayInfo,
} from '../src/shared/cursor-map';
import type { DisplayInfo } from '../src/shared/ipc';

const disp = (id: string, x: number, y: number, w: number, h: number, scaleFactor = 1): DisplayInfo =>
  ({ id, bounds: { x, y, width: w, height: h }, scaleFactor });

describe('mapCursorToFrame', () => {
  it('maps a point on the primary display to frame pixels', () => {
    const d = disp('1', 0, 0, 1920, 1080);
    expect(mapCursorToFrame({ x: 960, y: 540 }, d, { width: 1920, height: 1080 })).toEqual({ x: 960, y: 540 });
    expect(mapCursorToFrame({ x: 0, y: 0 }, d, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 0 });
    expect(mapCursorToFrame({ x: 1920, y: 1080 }, d, { width: 1920, height: 1080 })).toEqual({ x: 1920, y: 1080 });
  });

  it('handles a DPI-scaled display: DIP bounds, physical frame', () => {
    const d = disp('1', 0, 0, 1280, 720, 1.5); // 1920x1080 physical
    expect(mapCursorToFrame({ x: 640, y: 360 }, d, { width: 1920, height: 1080 })).toEqual({ x: 960, y: 540 });
    expect(framePxPerDip(d, { width: 1920, height: 1080 })).toBe(1.5);
  });

  it('copes with a capture that is smaller than bounds * scale', () => {
    const d = disp('1', 0, 0, 1920, 1080, 1.25);
    expect(mapCursorToFrame({ x: 960, y: 540 }, d, { width: 1280, height: 720 })).toEqual({ x: 640, y: 360 });
    expect(framePxPerDip(d, { width: 1280, height: 720 })).toBeCloseTo(2 / 3);
  });

  it('handles displays with an offset, including negative origins (monitor left of / above primary)', () => {
    const right = disp('2', 1920, 0, 2560, 1440);
    expect(mapCursorToFrame({ x: 1920 + 1280, y: 720 }, right, { width: 2560, height: 1440 })).toEqual({ x: 1280, y: 720 });
    const left = disp('3', -1600, -200, 1600, 900);
    expect(mapCursorToFrame({ x: -800, y: 250 }, left, { width: 1600, height: 900 })).toEqual({ x: 800, y: 450 });
  });

  it('returns null for points on another display or off-screen', () => {
    const d = disp('2', 1920, 0, 1920, 1080);
    expect(mapCursorToFrame({ x: 100, y: 100 }, d, { width: 1920, height: 1080 })).toBeNull();
    expect(mapCursorToFrame({ x: 1920, y: 1081 }, d, { width: 1920, height: 1080 })).toBeNull();
    expect(mapCursorToFrame({ x: 1919.9, y: 0 }, d, { width: 1920, height: 1080 })).toBeNull();
  });

  it('returns null for malformed input instead of NaN positions', () => {
    const d = disp('1', 0, 0, 100, 100);
    const f = { width: 100, height: 100 };
    expect(mapCursorToFrame({ x: NaN, y: 1 }, d, f)).toBeNull();
    expect(mapCursorToFrame({ x: 1, y: Infinity }, d, f)).toBeNull();
    expect(mapCursorToFrame({ x: 1, y: 1 }, d, { width: 0, height: 100 })).toBeNull();
    expect(mapCursorToFrame({ x: 1, y: 1 }, d, { width: NaN, height: 100 })).toBeNull();
    expect(mapCursorToFrame({ x: 1, y: 1 }, disp('1', 0, 0, 0, 100), f)).toBeNull();
    expect(mapCursorToFrame({ x: 1, y: 1 }, disp('1', NaN, 0, 100, 100), f)).toBeNull();
  });
});

describe('framePxPerDip', () => {
  it('falls back to the scale factor when the frame size is unknown or unusable', () => {
    const d = disp('1', 0, 0, 1280, 720, 2);
    expect(framePxPerDip(d, null)).toBe(2);
    expect(framePxPerDip(d, { width: 0, height: 0 })).toBe(2);
    expect(framePxPerDip({ ...d, scaleFactor: NaN }, null)).toBe(1);
  });
});

describe('sanitizeDisplayInfo', () => {
  it('accepts a good display and clamps the scale factor', () => {
    expect(sanitizeDisplayInfo(disp('7', -10, 5, 800, 600, 2))).toEqual(disp('7', -10, 5, 800, 600, 2));
    expect(sanitizeDisplayInfo(disp('7', 0, 0, 800, 600, 100))!.scaleFactor).toBe(8);
    expect(sanitizeDisplayInfo({ ...disp('7', 0, 0, 800, 600), scaleFactor: 'x' })!.scaleFactor).toBe(1);
  });
  it.each([
    [null], [undefined], [5], ['x'], [{}], [{ id: '1' }], [{ id: '1', bounds: null }],
    [{ id: '', bounds: { x: 0, y: 0, width: 1, height: 1 } }],
    [{ id: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
    [{ id: '1', bounds: { x: 0, y: 0, width: 0, height: 1 } }],
    [{ id: '1', bounds: { x: 0, y: 0, width: -5, height: 1 } }],
    [{ id: '1', bounds: { x: NaN, y: 0, width: 1, height: 1 } }],
    [{ id: 'x'.repeat(65), bounds: { x: 0, y: 0, width: 1, height: 1 } }],
  ])('rejects %j', (raw) => {
    expect(sanitizeDisplayInfo(raw)).toBeNull();
  });
});

describe('resolveDisplayForSource', () => {
  const a = disp('100', 0, 0, 1920, 1080);
  const b = disp('200', 1920, 0, 1920, 1080);
  const sources = [{ id: 'screen:0:0', display_id: '100' }, { id: 'screen:1:0', display_id: '200' }, { id: 'screen:2:0', display_id: '' }];

  it('matches by display_id', () => {
    expect(resolveDisplayForSource('screen:1:0', sources, [a, b])).toBe(b);
    expect(resolveDisplayForSource('screen:0:0', sources, [a, b])).toBe(a);
  });
  it('is unknown for windows, missing sources, null and malformed ids', () => {
    expect(resolveDisplayForSource('window:123:0', sources, [a, b])).toBeNull();
    expect(resolveDisplayForSource('screen:9:0', sources, [a, b])).toBeNull();
    expect(resolveDisplayForSource(null, sources, [a, b])).toBeNull();
    expect(resolveDisplayForSource(42 as unknown as string, sources, [a, b])).toBeNull();
  });
  it('does not guess when display_id is empty on a multi-monitor desktop, but can with a single display', () => {
    expect(resolveDisplayForSource('screen:2:0', sources, [a, b])).toBeNull();
    expect(resolveDisplayForSource('screen:2:0', sources, [a])).toBe(a);
  });
  it('is unknown when display_id names a display that no longer exists', () => {
    expect(resolveDisplayForSource('screen:1:0', sources, [a])).toBeNull();
  });
});
