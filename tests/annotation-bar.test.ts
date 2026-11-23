import { describe, expect, it } from 'vitest';
import { PEN_COLORS, PEN_WIDTHS } from '../src/shared/annotation';
import { barLayout, clampBarPos, defaultBarPos, sanitizeBarState } from '../src/shared/annotation-bar';
import { parseAnnotationEvent } from '../src/shared/annotation-strokes';

const ok = { x: 0.2, y: 0.1, color: PEN_COLORS[1], width: PEN_WIDTHS[2], visible: true };
const disp = { id: '1', widthDip: 1000, onCapture: true, captureKind: 'screen', captureDisplayId: '1' };

describe('sanitizeBarState', () => {
  it('accepts a valid state', () => { expect(sanitizeBarState(ok)).toEqual(ok); });
  it('strips unknown fields', () => { expect(sanitizeBarState({ ...ok, evil: 1 })).toEqual(ok); });
  it.each([
    null, 'x', 5, {}, { ...ok, x: -0.1 }, { ...ok, y: 1.1 }, { ...ok, x: NaN }, { ...ok, y: Infinity },
    { ...ok, x: '0.2' }, { ...ok, color: '#123456' }, { ...ok, width: 7 }, { ...ok, visible: 1 }, { ...ok, visible: undefined },
  ])('rejects %j', (raw) => { expect(sanitizeBarState(raw)).toBeNull(); });
  it('accepts an optional cursor and rejects a bad one', () => {
    expect(sanitizeBarState({ ...ok, cursor: { x: 0.5, y: 0.4 } })).toEqual({ ...ok, cursor: { x: 0.5, y: 0.4 } });
    expect(sanitizeBarState({ ...ok, cursor: null })).toEqual(ok);
    for (const cursor of [{ x: 2, y: 0 }, { x: 0, y: NaN }, { x: 0 }, 'a', 5]) expect(sanitizeBarState({ ...ok, cursor })).toBeNull();
  });
  it('accepts the 0 and 1 edges', () => {
    expect(sanitizeBarState({ ...ok, x: 0, y: 1, visible: false })).not.toBeNull();
  });
});

describe('barLayout', () => {
  const L = barLayout();
  const all = [L.grip, ...L.swatches, ...L.widths, L.clear, L.close];
  it('has one rect per colour and width', () => {
    expect(L.swatches).toHaveLength(PEN_COLORS.length);
    expect(L.widths).toHaveLength(PEN_WIDTHS.length);
  });
  it('keeps every item inside the bar, in left-to-right order, without overlaps', () => {
    for (const r of all) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(L.width);
      expect(r.y + r.height).toBeLessThanOrEqual(L.height);
    }
    for (let i = 1; i < all.length; i++) expect(all[i].x).toBeGreaterThanOrEqual(all[i - 1].x + all[i - 1].width);
  });
  it('is deterministic with integer-or-half DIP sizes', () => {
    expect(barLayout()).toEqual(L);
    expect(L.swatches[0].width).toBe(22);
    expect(L.widths[0]).toMatchObject({ width: 30, height: 22 });
  });
});

describe('clampBarPos', () => {
  const size = { width: 400, height: 40 };
  const vp = { width: 1000, height: 500 };
  it('leaves an inside position alone', () => { expect(clampBarPos(0.3, 0.2, size, vp)).toEqual({ x: 0.3, y: 0.2 }); });
  it('keeps the bar fully inside on every side', () => {
    expect(clampBarPos(-1, -1, size, vp)).toEqual({ x: 0, y: 0 });
    const c = clampBarPos(5, 5, size, vp);
    expect(c.x).toBeCloseTo(0.6);
    expect(c.y).toBeCloseTo(0.92);
  });
  it('handles NaN and a bar bigger than the viewport', () => {
    expect(clampBarPos(NaN, Infinity, size, vp)).toEqual({ x: 0, y: 0 });
    expect(clampBarPos(0.5, 0.5, { width: 2000, height: 900 }, vp)).toEqual({ x: 0, y: 0 });
  });
  it('defaults to top-centre', () => {
    const d = defaultBarPos(size, vp);
    expect(d.x).toBeCloseTo(0.3);
    expect(d.y).toBeCloseTo(12 / 500);
  });
});

describe('parseAnnotationEvent bar', () => {
  it('parses a bar event', () => { expect(parseAnnotationEvent({ t: 'bar', bar: ok, display: disp })).toEqual({ t: 'bar', bar: ok, display: disp }); });
  it('rejects a bad bar or display', () => {
    expect(parseAnnotationEvent({ t: 'bar', bar: { ...ok, x: 2 }, display: disp })).toBeNull();
    expect(parseAnnotationEvent({ t: 'bar', bar: ok, display: { id: '' } })).toBeNull();
    expect(parseAnnotationEvent({ t: 'bar', display: disp })).toBeNull();
  });
});
