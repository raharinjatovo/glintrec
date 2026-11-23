import { describe, expect, it } from 'vitest';
import {
  clientToCanvas, grabOffset, hitTestOverlay, overlayRectFor, pointerToPos, type OverlayLayoutOpts,
} from '../src/shared/overlay-layout';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';

const canvas = { width: 1920, height: 1080 };
const base: OverlayLayoutOpts = { corner: 'bottom-right', sizePercent: 20, marginPercent: 2, shape: 'circle', pos: null };

describe('overlayRectFor', () => {
  it('uses the corner when pos is null', () => {
    const r = overlayRectFor(canvas, base);
    expect(r).toEqual({ x: 1920 - 384 - 38, y: 1080 - 384 - 38, width: 384, height: 384 });
  });
  it('places from pos as fractions of the free space', () => {
    const r = overlayRectFor(canvas, { ...base, pos: { x: 0, y: 0 } });
    expect([r.x, r.y]).toEqual([0, 0]);
    const e = overlayRectFor(canvas, { ...base, pos: { x: 1, y: 1 } });
    expect([e.x + e.width, e.y + e.height]).toEqual([1920, 1080]);
    const m = overlayRectFor(canvas, { ...base, pos: { x: 0.5, y: 0.5 } });
    expect([m.x, m.y]).toEqual([(1920 - 384) / 2, (1080 - 384) / 2]);
  });
  it('rounded shape uses 16:9 height', () => {
    const r = overlayRectFor(canvas, { ...base, shape: 'rounded', pos: { x: 0, y: 1 } });
    expect(r.height).toBe(Math.round(384 / (16 / 9)));
    expect(r.y + r.height).toBe(1080);
  });
  it('clamps out-of-range pos and never leaves the canvas for any size', () => {
    for (const sizePercent of [10, 22, 40]) {
      for (const p of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: -3 }]) {
        const r = overlayRectFor(canvas, { ...base, sizePercent, pos: p });
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(canvas.width);
        expect(r.y + r.height).toBeLessThanOrEqual(canvas.height);
      }
    }
  });
  it('keeps the same edge pinned when the size changes', () => {
    const a = overlayRectFor(canvas, { ...base, sizePercent: 10, pos: { x: 1, y: 0 } });
    const b = overlayRectFor(canvas, { ...base, sizePercent: 40, pos: { x: 1, y: 0 } });
    expect(a.x + a.width).toBe(1920);
    expect(b.x + b.width).toBe(1920);
  });
  it('degenerate: overlay taller than canvas pins to 0', () => {
    const r = overlayRectFor({ width: 100, height: 20 }, { ...base, sizePercent: 40, pos: { x: 0.7, y: 0.7 } });
    expect(r.y).toBe(0);
  });
});

describe('hitTestOverlay', () => {
  const rect = { x: 100, y: 100, width: 200, height: 200 };
  it('circle: centre in, bounding-box corner out, edge in', () => {
    expect(hitTestOverlay({ x: 200, y: 200 }, rect, 'circle')).toBe(true);
    expect(hitTestOverlay({ x: 101, y: 101 }, rect, 'circle')).toBe(false);
    expect(hitTestOverlay({ x: 299, y: 200 }, rect, 'circle')).toBe(true);
    expect(hitTestOverlay({ x: 99, y: 200 }, rect, 'circle')).toBe(false);
  });
  it('rounded: corner pixel outside the radius is out, straight edges in', () => {
    const r = { x: 0, y: 0, width: 320, height: 180 };
    expect(hitTestOverlay({ x: 0.5, y: 0.5 }, r, 'rounded')).toBe(false);
    expect(hitTestOverlay({ x: 160, y: 1 }, r, 'rounded')).toBe(true);
    expect(hitTestOverlay({ x: 1, y: 90 }, r, 'rounded')).toBe(true);
    expect(hitTestOverlay({ x: 30, y: 30 }, r, 'rounded')).toBe(true);
    expect(hitTestOverlay({ x: 321, y: 90 }, r, 'rounded')).toBe(false);
  });
});

describe('pointerToPos / grabOffset', () => {
  const size = { width: 384, height: 384 };
  it('no jump on pointerdown: same pointer position reproduces the same rect', () => {
    const rect = overlayRectFor(canvas, { ...base, pos: { x: 0.3, y: 0.6 } });
    const p = { x: rect.x + 50, y: rect.y + 70 };
    const pos = pointerToPos(p, grabOffset(p, rect), canvas, size);
    const again = overlayRectFor(canvas, { ...base, pos });
    expect(Math.abs(again.x - rect.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(again.y - rect.y)).toBeLessThanOrEqual(1);
  });
  it('moves with the pointer, keeping the grab offset', () => {
    const rect = { x: 200, y: 100, width: 384, height: 384 };
    const grab = grabOffset({ x: 250, y: 130 }, rect);
    expect(grab).toEqual({ x: 50, y: 30 });
    const pos = pointerToPos({ x: 650, y: 330 }, grab, canvas, size);
    const r = overlayRectFor(canvas, { ...base, pos });
    expect([r.x, r.y]).toEqual([600, 300]);
  });
  it('clamps at all four edges', () => {
    const g = { x: 10, y: 10 };
    expect(pointerToPos({ x: -500, y: 500 }, g, canvas, size).x).toBe(0);
    expect(pointerToPos({ x: 5000, y: 500 }, g, canvas, size).x).toBe(1);
    expect(pointerToPos({ x: 500, y: -500 }, g, canvas, size).y).toBe(0);
    expect(pointerToPos({ x: 500, y: 5000 }, g, canvas, size).y).toBe(1);
  });
  it('no free space -> 0', () => {
    const full = { width: 100, height: 100 };
    expect(pointerToPos({ x: 10, y: 10 }, { x: 0, y: 0 }, full, full)).toEqual({ x: 0, y: 0 });
  });
});

describe('clientToCanvas', () => {
  it('maps a CSS-scaled canvas', () => {
    const box = { x: 10, y: 20, width: 960, height: 540 };
    expect(clientToCanvas(10 + 480, 20 + 270, box, canvas)).toEqual({ x: 960, y: 540 });
    expect(clientToCanvas(10, 20, box, canvas)).toEqual({ x: 0, y: 0 });
  });
  it('removes object-fit: contain letterboxing', () => {
    const box = { x: 0, y: 0, width: 960, height: 800 }; // content 960x540 centred vertically
    const p = clientToCanvas(480, 400, box, canvas);
    expect(p.x).toBeCloseTo(960);
    expect(p.y).toBeCloseTo(540);
    expect(clientToCanvas(0, 0, box, canvas).y).toBeLessThan(0);
  });
});

describe('sanitizeSettings: new fields', () => {
  it('old file without the new fields loads with defaults', () => {
    const old = { version: 1, cameraEnabled: false, overlay: { corner: 'top-left', sizePercent: 30, shape: 'rounded' } };
    const s = sanitizeSettings(old);
    expect(s.systemAudioEnabled).toBe(false);
    expect(s.overlay.pos).toBeNull();
    expect(s.overlay.corner).toBe('top-left');
    expect(s.cameraEnabled).toBe(false);
  });
  it('defaults', () => {
    expect(DEFAULT_SETTINGS.systemAudioEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.overlay.pos).toBeNull();
  });
  it('keeps a valid pos, clamps out-of-range, nulls wrong types', () => {
    expect(sanitizeSettings({ overlay: { pos: { x: 0.25, y: 0.75 } } }).overlay.pos).toEqual({ x: 0.25, y: 0.75 });
    expect(sanitizeSettings({ overlay: { pos: { x: -2, y: 9 } } }).overlay.pos).toEqual({ x: 0, y: 1 });
    for (const bad of ['x', 5, [], { x: 1 }, { x: '1', y: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: null, y: 0 }]) {
      expect(sanitizeSettings({ overlay: { pos: bad } }).overlay.pos).toBeNull();
    }
  });
  it('systemAudioEnabled only accepts booleans', () => {
    expect(sanitizeSettings({ systemAudioEnabled: true }).systemAudioEnabled).toBe(true);
    for (const bad of ['true', 1, null, {}, []]) {
      expect(sanitizeSettings({ systemAudioEnabled: bad }).systemAudioEnabled).toBe(false);
    }
  });
});

describe('floating window position mapping', () => {
  const area = { x: 1920, y: 0, width: 1920, height: 1080 };
  const win = { width: 400, height: 400 };
  it('round-trips pos through the window origin on any display', async () => {
    const { posToWindowOrigin, windowOriginToPos } = await import('../src/shared/overlay-layout');
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.25, y: 0.75 }]) {
      const o = posToWindowOrigin(p, area, win);
      const back = windowOriginToPos(o, area, win);
      expect(back.x).toBeCloseTo(p.x, 2);
      expect(back.y).toBeCloseTo(p.y, 2);
    }
  });
  it('keeps the window inside the display and clamps strays', async () => {
    const { posToWindowOrigin, windowOriginToPos } = await import('../src/shared/overlay-layout');
    expect(posToWindowOrigin({ x: 1, y: 1 }, area, win)).toEqual({ x: 1920 + 1520, y: 680 });
    expect(windowOriginToPos({ x: -500, y: 5000 }, area, win)).toEqual({ x: 0, y: 1 });
  });
});
