import { describe, expect, it } from 'vitest';
import type { RecorderApi } from '../src/shared/ipc';
import { createAnnotationLayer } from '../src/renderer/annotation-layer';
import type { BarState } from '../src/shared/annotation-bar';

const disp = { id: '1', widthDip: 1000, onCapture: true, captureKind: 'screen' as const, captureDisplayId: '1' };
const stroke = { id: 1, from: 0, color: '#ff3b30', width: 6, pts: [0, 0, 0.5, 0.5, 1, 1] };
const frame = { width: 2000, height: 1000 };
const full = { x: 0, y: 0, width: 2000, height: 1000 };
const dest = { x: 0, y: 0, width: 1000, height: 500 };

function rig(sourceId: string | null = 'screen:0:0') {
  let cb: (ev: unknown) => void = () => {};
  const api = { onAnnotation: (f: (ev: unknown) => void) => { cb = f; return () => {}; } } as unknown as RecorderApi;
  const notes: string[] = [];
  let src = sourceId;
  const layer = createAnnotationLayer(api, () => src, (m) => notes.push(m));
  const calls: string[] = [];
  const rec: Record<string, unknown> = {};
  const ctx = new Proxy(rec, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => { calls.push(`${k}(${a.map((x) => (typeof x === 'number' ? +x.toFixed(2) : x)).join(',')})`); }),
    set: (t, k: string, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { layer, ctx, calls, rec, notes, send: (ev: unknown) => cb(ev), setSrc: (s: string | null) => { src = s; } };
}
const ev = (s = stroke, d = disp) => ({ t: 'stroke', stroke: s, display: d });

describe('annotation layer draw', () => {
  it('draws nothing before any stroke, after clear, and for a degenerate frame', () => {
    const r = rig();
    r.layer.draw(r.ctx, full, dest, frame);
    r.send(ev());
    r.layer.draw(r.ctx, full, dest, { width: 0, height: 0 });
    expect(r.calls).toHaveLength(0);
    r.send({ t: 'clear' });
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toHaveLength(0);
  });
  it('ignores malformed events', () => {
    const r = rig();
    r.send({ t: 'stroke', stroke: { ...stroke, color: 'red' }, display: disp });
    r.send(null);
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toHaveLength(0);
  });
  it('clips to dest and strokes through the frame -> dest transform with scaled width', () => {
    const r = rig();
    r.send(ev());
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toContain('rect(0,0,1000,500)');
    expect(r.calls).toContain('clip()');
    expect(r.calls).toContain('moveTo(0,0)');
    expect(r.calls).toContain('lineTo(1000,500)');
    expect(r.calls.at(-1)).toBe('restore()');
    // 6 dip * (2000/1000 px per dip) * (1000/2000 view->dest) = 6
    expect(r.rec.lineWidth).toBeCloseTo(6);
    expect(r.rec.strokeStyle).toBe('#ff3b30');
  });
  it('follows the zoom view (stroke moves with the content, width scales up)', () => {
    const r = rig();
    r.send(ev({ ...stroke, pts: [0.5, 0.5, 0.75, 0.75] }));
    r.layer.draw(r.ctx, { x: 500, y: 250, width: 1000, height: 500 }, dest, frame);
    expect(r.calls).toContain('moveTo(500,250)');
    expect(r.rec.lineWidth).toBeCloseTo(12);
  });
  it('draws a single-point stroke (tap) as a dot', () => {
    const r = rig();
    r.send(ev({ ...stroke, pts: [0.5, 0.5] }));
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls.some((c) => c.startsWith('arc(500,250,3'))).toBe(true);
    expect(r.calls).toContain('fill()');
    expect(r.calls.some((c) => c.startsWith('stroke'))).toBe(false);
  });
  it('draws strokes appended after the first message', () => {
    const r = rig();
    r.send(ev({ ...stroke, pts: [0, 0, 0.5, 0.5] }));
    r.send(ev({ ...stroke, from: 4, pts: [1, 1] }));
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toContain('lineTo(1000,500)');
  });
  it('draws nothing when the view has zero size', () => {
    const r = rig();
    r.send(ev());
    r.layer.draw(r.ctx, { x: 0, y: 0, width: 0, height: 0 }, dest, frame);
    expect(r.calls).toHaveLength(0);
  });
});

describe('annotation layer skip reasons', () => {
  it('does not draw and reports once for a window source', () => {
    const r = rig('window:1:0');
    r.send(ev());
    r.layer.draw(r.ctx, full, dest, frame);
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toHaveLength(0);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatch(/window/);
  });
  it('does not draw when main says the display is not the captured one', () => {
    const r = rig();
    r.send(ev(stroke, { ...disp, onCapture: false, id: '2', captureDisplayId: '1' }));
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toHaveLength(0);
    expect(r.notes[0]).toMatch(/mismatch/);
  });
  it('starts drawing when the source becomes a screen, and reports a new reason again', () => {
    const r = rig(null);
    r.send(ev());
    expect(r.notes).toHaveLength(1);
    r.setSrc('window:1:0');
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.notes).toHaveLength(2);
    r.setSrc('screen:0:0');
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toContain('clip()');
  });
  // KNOWN BUG: annotation-layer.ts:29 clear does not reset lastReason, so the notice is not repeated. Remove .fails once fixed.
  it('re-reports the same reason after a clear and a new stroke', () => {
    const r = rig('window:1:0');
    r.send(ev());
    r.send({ t: 'clear' });
    r.send(ev());
    expect(r.notes).toHaveLength(2);
  });
});

describe('annotation layer toolbar', () => {
  const bar = { x: 0.5, y: 0.5, color: '#34c759', width: 6, visible: true };
  const barEv = (b: BarState = bar, d = disp) => ({ t: 'bar', bar: b, display: d });
  it('draws a bar-only state (no strokes) and ringed selection', () => {
    const r = rig();
    r.send(barEv());
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toContain('clip()');
    expect(r.calls.some((c) => c.startsWith('fillText(Clear'))).toBe(true);
    expect(r.calls.some((c) => c.startsWith('fillText(Close'))).toBe(true);
    // 5 swatches + 3 width dots + 6 grip dots, plus 1 ring arc for the selected swatch
    expect(r.calls.filter((c) => c.startsWith('arc(')).length).toBeGreaterThanOrEqual(15);
  });
  it('draws nothing when hidden, after a clear, or for a window source', () => {
    const r = rig();
    r.send(barEv({ ...bar, visible: false }));
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toHaveLength(0);
    r.send(barEv());
    r.send({ t: 'clear' });
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls).toHaveLength(0);
    const w = rig('window:1:0');
    w.send(barEv());
    w.layer.draw(w.ctx, full, dest, frame);
    expect(w.calls).toHaveLength(0);
    expect(w.notes[0]).toMatch(/window/);
  });
  it('places the bar through the frame -> dest transform and scales it with the zoom', () => {
    const origin = (c: string[]) => c.find((x) => x.startsWith('moveTo('))!;
    const a = rig();
    a.send(barEv());
    a.layer.draw(a.ctx, full, dest, frame);
    // top-left at fraction .5/.5 of the 2000x1000 frame -> (500,250) on a 1000x500 dest; k = 1 -> corner after rounding is x+10
    expect(origin(a.calls)).toBe('moveTo(510,250)');
    const z = rig();
    z.send(barEv());
    z.layer.draw(z.ctx, { x: 500, y: 250, width: 500, height: 250 }, dest, frame);
    // 2x zoom: origin (1000,500) on dest, k = 4, corner radius 10 dip = 40 px
    expect(origin(z.calls)).toBe('moveTo(1040,500)');
    expect(String(z.rec.font)).toContain('52px'); // 13px * k
  });
  it('draws the cursor arrow after the bar only when a cursor is set', () => {
    const a = rig();
    a.send(barEv());
    a.layer.draw(a.ctx, full, dest, frame);
    const close = (c: string[]) => c.findIndex((x) => x.startsWith('fillText(Close'));
    expect(a.calls.slice(close(a.calls)).some((c) => c.startsWith('lineTo'))).toBe(false);
    const b = rig();
    b.send(barEv({ ...bar, cursor: { x: 0.6, y: 0.5 } }));
    b.layer.draw(b.ctx, full, dest, frame);
    const after = b.calls.slice(close(b.calls));
    expect(after).toContain('moveTo(600,250)');
    expect(after.filter((c) => c.startsWith('lineTo'))).toHaveLength(6);
    expect(b.rec.fillStyle).toBe('#ffffff');
  });
  it('draws the bar after the strokes, inside the same clip', () => {
    const r = rig();
    r.send(ev());
    r.send(barEv());
    r.layer.draw(r.ctx, full, dest, frame);
    expect(r.calls.filter((c) => c === 'clip()')).toHaveLength(1);
    expect(r.calls.indexOf('lineTo(1000,500)')).toBeLessThan(r.calls.findIndex((c) => c.startsWith('fillText(Clear')));
  });
});
