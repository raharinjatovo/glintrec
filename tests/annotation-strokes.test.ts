import { describe, expect, it } from 'vitest';
import { MAX_POINTS_PER_STROKE, MAX_STROKES } from '../src/shared/annotation';
import { createStrokeSender } from '../src/shared/stroke-sender';
import {
  type StrokeUpdate, createStrokeStore, MAX_TOTAL_COORDS, parseAnnotationEvent, sanitizeStrokeUpdate, strokePointToCanvas, strokePxPerDip,
  annotationSkipReason, overlaySkipReason, captureKindOf, decideCaptureMatch, sanitizeAnnotationDisplay,
} from '../src/shared/annotation-strokes';

const good = { id: 1, from: 0, color: '#ff3b30', width: 6, pts: [0, 0, 0.5, 0.5, 1, 1] };
const disp = { id: '1', widthDip: 1920, onCapture: true, captureKind: 'screen' as const, captureDisplayId: '1' };

describe('sanitizeStrokeUpdate', () => {
  it('accepts a valid stroke', () => {
    expect(sanitizeStrokeUpdate(good)).toEqual(good);
    expect(sanitizeStrokeUpdate({ ...good, pts: [0.2, 0.3] })?.pts).toEqual([0.2, 0.3]);
  });
  it('rejects non-objects and missing fields', () => {
    for (const v of [null, undefined, 5, 'x', [], {}, { color: '#ff3b30' }]) expect(sanitizeStrokeUpdate(v)).toBeNull();
  });
  it('rejects non-whitelisted colors and widths', () => {
    for (const color of ['red', '#ff3b3', '#FF3B30', 'url(x)', '#123456', 5, null]) expect(sanitizeStrokeUpdate({ ...good, color })).toBeNull();
    for (const width of [0, 4, 100, -3, NaN, '6', null]) expect(sanitizeStrokeUpdate({ ...good, width })).toBeNull();
  });
  it('rejects NaN, Infinity, out of range and non-number points', () => {
    for (const bad of [NaN, Infinity, -Infinity, -0.01, 1.01, '0.5', null, undefined, {}]) {
      expect(sanitizeStrokeUpdate({ ...good, pts: [0.1, 0.1, bad, 0.2] })).toBeNull();
    }
  });
  it('rejects odd, empty and non-array point lists', () => {
    for (const pts of [[], [0.1], [0.1, 0.2, 0.3], 'abc', { length: 2 }, null]) expect(sanitizeStrokeUpdate({ ...good, pts })).toBeNull();
  });
  it('rejects oversized point lists without scanning them', () => {
    const huge = new Array(MAX_POINTS_PER_STROKE * 2 + 2).fill(0.5);
    expect(sanitizeStrokeUpdate({ ...good, pts: huge })).toBeNull();
    expect(sanitizeStrokeUpdate({ ...good, pts: new Array(MAX_POINTS_PER_STROKE * 2).fill(0.5) })).not.toBeNull();
    expect(sanitizeStrokeUpdate({ ...good, pts: new Array(5_000_000).fill(0.5) })).toBeNull();
  });
  it('copies the data (no shared references with the input)', () => {
    const input = { ...good, pts: [0.1, 0.2] };
    const out = sanitizeStrokeUpdate(input)!;
    input.pts[0] = 0.9;
    expect(out.pts[0]).toBe(0.1);
  });
});

describe('sanitizeStrokeUpdate id and from', () => {
  it('requires a small non-negative integer id', () => {
    for (const id of [undefined, -1, 1.5, NaN, Infinity, '1', null, 2 ** 31, 2 ** 53]) expect(sanitizeStrokeUpdate({ ...good, id })).toBeNull();
    expect(sanitizeStrokeUpdate({ ...good, id: 0 })?.id).toBe(0);
  });
  it('requires an even in-range from index', () => {
    for (const from of [undefined, -2, 1, 3, 0.5, NaN, '0', null, MAX_POINTS_PER_STROKE * 2, 1e9]) expect(sanitizeStrokeUpdate({ ...good, from })).toBeNull();
    expect(sanitizeStrokeUpdate({ ...good, from: 6 })?.from).toBe(6);
  });
});

describe('parseAnnotationEvent', () => {
  it('parses clear and stroke events', () => {
    expect(parseAnnotationEvent({ t: 'clear' })).toEqual({ t: 'clear' });
    expect(parseAnnotationEvent({ t: 'stroke', stroke: good, display: disp })).toEqual({ t: 'stroke', stroke: good, display: disp });
  });
  it('rejects garbage', () => {
    for (const v of [null, 3, {}, { t: 'nope' }, { t: 'stroke' }, { t: 'stroke', stroke: good }]) expect(parseAnnotationEvent(v)).toBeNull();
    expect(parseAnnotationEvent({ t: 'stroke', stroke: { ...good, color: 'x' }, display: disp })).toBeNull();
    for (const d of [{ ...disp, id: '' }, { ...disp, id: 5 }, { ...disp, widthDip: 0 }, { ...disp, widthDip: NaN }, { ...disp, widthDip: -5 }]) {
      expect(parseAnnotationEvent({ t: 'stroke', stroke: good, display: d })).toBeNull();
    }
  });
});

describe('createStrokeStore', () => {
  it('caps the stroke count, dropping the oldest', () => {
    const s = createStrokeStore();
    for (let i = 0; i < MAX_STROKES + 5; i++) s.apply({ ...good, id: i, pts: [i / 1000, 0] }, disp);
    expect(s.strokes()).toHaveLength(MAX_STROKES);
    expect(s.strokes()[0].pts[0]).toBeCloseTo(5 / 1000);
  });
  it('caps total coordinates', () => {
    const s = createStrokeStore();
    const big = { ...good, pts: new Array(MAX_POINTS_PER_STROKE * 2).fill(0.5) };
    for (let i = 0; i < 100; i++) s.apply({ ...big, id: i }, disp);
    const total = s.strokes().reduce((n, x) => n + x.pts.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_COORDS);
    expect(s.strokes().length).toBeGreaterThan(0);
  });
  it('clears, and a stroke from another display replaces the set', () => {
    const s = createStrokeStore();
    s.apply(good, disp);
    s.apply({ ...good, id: 2 }, { ...disp, id: '2' });
    expect(s.strokes()).toHaveLength(1);
    expect(s.display()?.id).toBe('2');
    s.clear();
    expect(s.strokes()).toHaveLength(0);
    expect(s.display()).toBeNull();
  });
});

describe('createStrokeStore live updates', () => {
  const a = { id: 7, from: 0, color: '#34c759', width: 3, pts: [0.1, 0.1, 0.2, 0.2] };
  it('upserts by id: a replay never duplicates and replaces the points', () => {
    const s = createStrokeStore();
    s.apply(a, disp);
    s.apply({ ...a, pts: [0.5, 0.5] }, disp);
    expect(s.strokes()).toHaveLength(1);
    expect(s.strokes()[0].pts).toEqual([0.5, 0.5]);
    s.apply({ ...a, id: 8 }, disp);
    expect(s.strokes().map((x) => x.id)).toEqual([7, 8]);
  });
  it('appends only where the stored stroke ends', () => {
    const s = createStrokeStore();
    s.apply(a, disp);
    s.apply({ ...a, from: 4, pts: [0.3, 0.3] }, disp);
    expect(s.strokes()[0].pts).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
    s.apply({ ...a, from: 4, pts: [0.9, 0.9] }, disp); // duplicate / reordered: ignored
    s.apply({ ...a, from: 10, pts: [0.9, 0.9] }, disp); // gap: ignored
    expect(s.strokes()[0].pts).toHaveLength(6);
  });
  it('ignores an append for an unknown (cleared or evicted) id and other displays', () => {
    const s = createStrokeStore();
    s.apply({ ...a, from: 4, pts: [0.3, 0.3] }, disp);
    expect(s.strokes()).toHaveLength(0);
    expect(s.display()).toBeNull();
    s.apply(a, disp);
    s.clear();
    s.apply({ ...a, from: 4, pts: [0.3, 0.3] }, disp); // late message after Clear
    expect(s.strokes()).toHaveLength(0);
    s.apply(a, disp);
    s.apply({ ...a, from: 4, pts: [0.3, 0.3] }, { ...disp, id: '9' });
    expect(s.strokes()[0].pts).toHaveLength(4);
  });
  it('truncates an append at the per-stroke cap and keeps the total correct', () => {
    const s = createStrokeStore();
    const cap = MAX_POINTS_PER_STROKE * 2;
    s.apply({ ...a, pts: new Array(cap - 2).fill(0.5) }, disp);
    s.apply({ ...a, from: cap - 2, pts: [0.1, 0.1, 0.2, 0.2, 0.3, 0.3] }, disp);
    expect(s.strokes()[0].pts).toHaveLength(cap);
    s.apply({ ...a, from: cap, pts: [0.4, 0.4] }, disp);
    expect(s.strokes()[0].pts).toHaveLength(cap);
    // a replacement of the grown stroke releases its coordinates: nothing leaks into the total
    for (let i = 0; i < 100; i++) s.apply({ ...a, pts: new Array(cap).fill(0.5) }, disp);
    expect(s.strokes()).toHaveLength(1);
    for (let i = 0; i < 100; i++) s.apply({ ...a, id: 100 + i, pts: new Array(cap).fill(0.5) }, disp);
    expect(s.strokes().reduce((n, x) => n + x.pts.length, 0)).toBeLessThanOrEqual(MAX_TOTAL_COORDS);
  });
  it('growth past the total cap drops the oldest strokes, not the growing one', () => {
    const s = createStrokeStore();
    const cap = MAX_POINTS_PER_STROKE * 2;
    for (let i = 0; i < 50; i++) s.apply({ ...a, id: i, pts: new Array(cap).fill(0.5) }, disp);
    s.apply({ ...a, id: 99, pts: [0.1, 0.1] }, disp);
    s.apply({ ...a, id: 99, from: 2, pts: new Array(cap - 2).fill(0.5) }, disp);
    const total = s.strokes().reduce((n, x) => n + x.pts.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_COORDS);
    expect(s.strokes().at(-1)?.id).toBe(99);
    expect(s.strokes().at(-1)?.pts).toHaveLength(cap);
  });
});

describe('createStrokeSender', () => {
  function rig() {
    const sent: StrokeUpdate[] = [];
    let timer: (() => void) | null = null;
    let scheduled = 0;
    const sender = createStrokeSender((u) => sent.push(u), 40, {
      set: (fn) => { timer = fn; scheduled++; return 1; },
      clear: () => { timer = null; },
    });
    return { sent, sender, fire: () => { const f = timer; timer = null; f?.(); }, scheduled: () => scheduled };
  }
  it('sends only the new points, throttled to one timer per interval', () => {
    const r = rig();
    const pts: number[] = [];
    r.sender.begin({ id: 3, color: '#ff3b30', width: 6 }, pts);
    pts.push(0.1, 0.1); r.sender.changed();
    pts.push(0.2, 0.2); r.sender.changed();
    expect(r.scheduled()).toBe(1);
    expect(r.sent).toHaveLength(0);
    r.fire();
    expect(r.sent).toEqual([{ id: 3, color: '#ff3b30', width: 6, pts: [0.1, 0.1, 0.2, 0.2], from: 0 }]);
    pts.push(0.3, 0.3); r.sender.changed();
    r.fire();
    expect(r.sent[1]).toMatchObject({ pts: [0.3, 0.3], from: 4 });
  });
  it('flushes the rest on end and sends nothing when nothing is new', () => {
    const r = rig();
    const pts: number[] = [0.1, 0.1];
    r.sender.begin({ id: 1, color: '#ff3b30', width: 3 }, pts);
    r.sender.changed();
    r.sender.end(); // quick tap: pen up before the timer
    expect(r.sent).toHaveLength(1);
    r.fire();
    r.sender.end();
    expect(r.sent).toHaveLength(1);
  });
  it('cancel drops unsent points (Clear)', () => {
    const r = rig();
    const pts: number[] = [0.1, 0.1];
    r.sender.begin({ id: 1, color: '#ff3b30', width: 3 }, pts);
    r.sender.changed();
    r.sender.cancel();
    r.sender.end();
    expect(r.sent).toHaveLength(0);
  });
  it('a new stroke flushes the previous one first', () => {
    const r = rig();
    const p1: number[] = [0.1, 0.1];
    r.sender.begin({ id: 1, color: '#ff3b30', width: 3 }, p1);
    r.sender.changed();
    r.sender.begin({ id: 2, color: '#ff3b30', width: 3 }, []);
    expect(r.sent.map((u) => u.id)).toEqual([1]);
  });
});

describe('mapping', () => {
  const frame = { width: 2000, height: 1000 };
  const full = { x: 0, y: 0, width: 2000, height: 1000 };
  const dest = { x: 0, y: 100, width: 1000, height: 500 };
  it('maps fractions through the frame to the canvas', () => {
    expect(strokePointToCanvas(0.5, 0.5, frame, full, dest)).toEqual({ x: 500, y: 350 });
    expect(strokePointToCanvas(0, 0, frame, full, dest)).toEqual({ x: 0, y: 100 });
  });
  it('follows the zoom view so strokes stay on the same content', () => {
    // 2x zoom centred on the frame centre: the frame centre stays at the dest centre, the corner moves outside.
    const view = { x: 500, y: 250, width: 1000, height: 500 };
    expect(strokePointToCanvas(0.5, 0.5, frame, view, dest)).toEqual({ x: 500, y: 350 });
    expect(strokePointToCanvas(0.25, 0.25, frame, view, dest)).toEqual({ x: 0, y: 100 });
    expect(strokePointToCanvas(0, 0, frame, view, dest).x).toBeLessThan(0);
  });
  it('scales pen widths with frame resolution and zoom', () => {
    expect(strokePxPerDip(disp, { width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 960, height: 540 })).toBeCloseTo(0.5);
    expect(strokePxPerDip(disp, { width: 1920, height: 1080 }, { x: 0, y: 0, width: 960, height: 540 }, { x: 0, y: 0, width: 960, height: 540 })).toBeCloseTo(1);
    expect(strokePxPerDip(disp, frame, { x: 0, y: 0, width: 0, height: 0 }, dest)).toBe(0);
  });
});

describe('decideCaptureMatch', () => {
  it('requires a screen source', () => {
    expect(decideCaptureMatch('window', '1', '1')).toBe(false);
    expect(decideCaptureMatch('none', null, '1')).toBe(false);
  });
  it('compares display ids when the captured display is known', () => {
    expect(decideCaptureMatch('screen', '1', '1')).toBe(true);
    expect(decideCaptureMatch('screen', '2', '1')).toBe(false);
  });
  it('treats an unknown captured display as a match (overlay opened on the captured display)', () => {
    expect(decideCaptureMatch('screen', null, '1')).toBe(true);
    expect(decideCaptureMatch('screen', '', '1')).toBe(true);
  });
});

describe('captureKindOf', () => {
  it('classifies source ids', () => {
    expect(captureKindOf('screen:0:0')).toBe('screen');
    expect(captureKindOf('window:12:0')).toBe('window');
    expect(captureKindOf('camera')).toBe('none');
    expect(captureKindOf(null)).toBe('none');
  });
});

describe('annotationSkipReason', () => {
  it('is null when nothing was drawn or the strokes can be drawn', () => {
    expect(annotationSkipReason(null, 'window:1')).toBeNull();
    expect(annotationSkipReason(disp, 'screen:0:0')).toBeNull();
  });
  it('explains the renderer-side source problems', () => {
    expect(annotationSkipReason(disp, null)).toMatch(/no screen source/);
    expect(annotationSkipReason(disp, 'window:1:0')).toMatch(/is a window/);
  });
  it('explains a display mismatch with both ids', () => {
    const r = annotationSkipReason({ ...disp, onCapture: false, id: '7', captureDisplayId: '3' }, 'screen:0:0');
    expect(r).toMatch(/overlay display 7 vs capture 3/);
    expect(annotationSkipReason({ ...disp, onCapture: false, captureDisplayId: '' }, 'screen:0:0')).toMatch(/vs capture unknown/);
  });
  it('explains a main/renderer disagreement about the source kind', () => {
    expect(annotationSkipReason({ ...disp, onCapture: false, captureKind: 'window' }, 'screen:0:0')).toMatch(/sees the capture source as window/);
  });
});

describe('sanitizeAnnotationDisplay', () => {
  it('keeps the main-decided tag and defaults safely', () => {
    expect(sanitizeAnnotationDisplay(disp)).toEqual(disp);
    expect(sanitizeAnnotationDisplay({ id: '1', widthDip: 100 })).toEqual({ id: '1', widthDip: 100, onCapture: false, captureKind: 'none', captureDisplayId: '' });
    expect(sanitizeAnnotationDisplay({ ...disp, onCapture: 'yes', captureKind: 'x' })?.onCapture).toBe(false);
    expect(sanitizeAnnotationDisplay({ ...disp, widthDip: 0 })).toBeNull();
  });
});

describe('overlaySkipReason', () => {
  it('is null when the strokes reach the recording', () => {
    expect(overlaySkipReason(disp)).toBeNull();
  });
  it('names the reason shown on the overlay', () => {
    expect(overlaySkipReason({ ...disp, onCapture: false, captureKind: 'window' })).toMatch(/window is being captured/);
    expect(overlaySkipReason({ ...disp, onCapture: false, captureKind: 'none' })).toMatch(/no screen is selected/);
    expect(overlaySkipReason({ ...disp, onCapture: false, captureKind: 'screen', id: '7', captureDisplayId: '3' })).toMatch(/\(7\).*\(3\)/);
  });
});
