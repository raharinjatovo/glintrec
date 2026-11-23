import { describe, expect, it } from 'vitest';
import { controlHudDockedRect, pickControlHudAnchor, type ControlHudAnchor } from '../src/shared/control-hud';

const area = { x: 0, y: 0, width: 1920, height: 1080 };
const bar: ControlHudAnchor = { bar: { x: 800, y: 12, width: 420, height: 38 }, area };
const mobile: ControlHudAnchor = { bar: { x: 700, y: 100, width: 400, height: 760 }, area };
const size = { width: 330, height: 44 };
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('toolbar anchor priority', () => {
  it('is null outside mobile output', () => { expect(pickControlHudAnchor(bar, mobile, false)).toBeNull(); });
  it('annotation bar beats the mobile window', () => { expect(pickControlHudAnchor(bar, mobile, true)).toBe(bar); });
  it('falls back to the mobile window, then to top-centre', () => {
    expect(pickControlHudAnchor(null, mobile, true)).toBe(mobile);
    expect(pickControlHudAnchor(null, null, true)).toBeNull();
  });
});

describe('docking next to the mobile window', () => {
  it('goes below the window without overlapping it', () => {
    const r = controlHudDockedRect(mobile, size, 8);
    expect(r.y).toBe(868);
    expect(overlaps(r, mobile.bar)).toBe(false);
  });
  it('goes above when there is no room below', () => {
    const a = { bar: { x: 700, y: 300, width: 400, height: 760 }, area };
    const r = controlHudDockedRect(a, size, 8);
    expect(r.y + r.height).toBeLessThanOrEqual(300);
    expect(overlaps(r, a.bar)).toBe(false);
  });
  it('goes beside the window when it fills the height, clamped to the display', () => {
    const a = { bar: { x: 1500, y: 0, width: 400, height: 1080 }, area };
    const r = controlHudDockedRect(a, size, 8);
    expect(overlaps(r, a.bar)).toBe(false);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(1920);
  });
});
