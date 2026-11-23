import { describe, expect, it } from 'vitest';
import { overPassThrough, pointInRect } from '../src/shared/pass-through';

const r = { x: 100, y: 50, width: 330, height: 44 };

describe('pass-through hit test', () => {
  it('is half-open on the rect edges', () => {
    expect(pointInRect({ x: 100, y: 50 }, r)).toBe(true);
    expect(pointInRect({ x: 429, y: 93 }, r)).toBe(true);
    expect(pointInRect({ x: 430, y: 60 }, r)).toBe(false);
    expect(pointInRect({ x: 200, y: 94 }, r)).toBe(false);
    expect(pointInRect({ x: 99, y: 60 }, r)).toBe(false);
  });
  it('grows the rect by the padding', () => {
    expect(pointInRect({ x: 98, y: 48 }, r, 2)).toBe(true);
    expect(pointInRect({ x: 97, y: 48 }, r, 2)).toBe(false);
  });
  it('checks several rects and ignores null / empty ones', () => {
    expect(overPassThrough({ x: 110, y: 60 }, [null, undefined, r])).toBe(true);
    expect(overPassThrough({ x: 10, y: 10 }, [null, r])).toBe(false);
    expect(overPassThrough({ x: 5, y: 5 }, [{ x: 5, y: 5, width: 0, height: 0 }])).toBe(false);
    expect(overPassThrough({ x: 5, y: 5 }, [])).toBe(false);
  });
});
