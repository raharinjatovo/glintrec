import { describe, expect, it } from 'vitest';
import { pruneRipples, RIPPLE_MS } from '../src/shared/ripples';
import { stepZoom } from '../src/shared/zoom';

describe('lot 2 review fixes', () => {
  it('pruneRipples returns the same array when nothing expired', () => {
    const list = [{ x: 1, y: 1, at: 100, button: 'left' as const }];
    expect(pruneRipples(list, 100 + RIPPLE_MS - 1)).toBe(list);
  });
  it('stepZoom never yields NaN for a NaN or zero-size frame', () => {
    const s = { zoom: 1, cx: 10, cy: 10 };
    for (const frame of [{ width: NaN, height: NaN }, { width: 0, height: 0 }, { width: Infinity, height: -5 }]) {
      const r = stepZoom(s, 2, { x: NaN, y: 5, at: 0 }, frame, 16);
      for (const v of [r.zoom, r.cx, r.cy]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
