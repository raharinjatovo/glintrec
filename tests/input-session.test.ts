import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInputSession, type HookLike, type HookLoad } from '../src/main/input-session';
import type { DisplayInfo, InputEvent } from '../src/shared/ipc';

const DISPLAY: DisplayInfo = { id: '1', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };

function fakeHook(opts: { failStart?: boolean } = {}) {
  const handlers = new Map<string, ((e: never) => void)[]>();
  const hook = {
    on: vi.fn((ev: string, fn: (e: never) => void) => { handlers.set(ev, [...(handlers.get(ev) ?? []), fn]); }),
    removeListener: vi.fn((ev: string, fn: (e: never) => void) => { handlers.set(ev, (handlers.get(ev) ?? []).filter((f) => f !== fn)); }),
    start: vi.fn(() => { if (opts.failStart) throw new Error('boom'); }),
    stop: vi.fn(),
  };
  const fire = (ev: string, payload: unknown) => (handlers.get(ev) ?? []).forEach((f) => f(payload as never));
  const count = (ev: string) => (handlers.get(ev) ?? []).length;
  return { hook: hook as HookLike & typeof hook, fire, count };
}

function setup(over: { load?: HookLoad; display?: DisplayInfo | null; failStart?: boolean } = {}) {
  const fh = fakeHook({ failStart: over.failStart });
  const events: InputEvent[] = [];
  let cursor = { x: 10, y: 20 };
  const loadHook = vi.fn((): HookLoad => over.load ?? { hook: fh.hook, error: null });
  const session = createInputSession({
    loadHook,
    cursorPoint: () => cursor,
    emit: (e) => events.push(e),
    resolveDisplay: async () => (over.display === undefined ? DISPLAY : over.display),
    pollMs: 10,
  });
  return { session, events, fh, loadHook, moveTo: (x: number, y: number) => { cursor = { x, y }; } };
}
const key = (keycode: number, o: object = {}) => ({ keycode, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });

describe('input session lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does nothing until started: the native hook is not even loaded while idle', () => {
    const { loadHook, fh, session } = setup();
    expect(loadHook).not.toHaveBeenCalled();
    expect(fh.hook.start).not.toHaveBeenCalled();
    expect(session.active()).toBe(false);
  });

  it('start hooks the mouse/keys that were asked for; stop removes listeners and stops the hook', async () => {
    const { session, fh } = setup();
    const res = await session.start({ cursor: false, clicks: true, keys: true });
    expect(res).toEqual({ hookAvailable: true, display: DISPLAY, message: '' });
    expect(fh.hook.start).toHaveBeenCalledTimes(1);
    expect(fh.count('mousedown')).toBe(1);
    expect(fh.count('keydown')).toBe(1);
    session.stop();
    expect(fh.hook.stop).toHaveBeenCalledTimes(1);
    expect(fh.count('mousedown')).toBe(0);
    expect(fh.count('keydown')).toBe(0);
    expect(session.active()).toBe(false);
    session.stop(); // idempotent
    expect(fh.hook.stop).toHaveBeenCalledTimes(1);
  });

  it('does not listen to keys unless keystrokes were requested, nor to the mouse unless clicks were', async () => {
    const { session, fh, events } = setup();
    await session.start({ cursor: false, clicks: true, keys: false });
    expect(fh.count('keydown')).toBe(0);
    fh.fire('keydown', key(30));
    expect(events).toEqual([]);
    session.stop();
    await session.start({ cursor: false, clicks: false, keys: true });
    expect(fh.count('mousedown')).toBe(0);
  });

  it('never loads the hook when only the cursor is requested', async () => {
    const { session, loadHook } = setup();
    await session.start({ cursor: true, clicks: false, keys: false });
    expect(loadHook).not.toHaveBeenCalled();
    session.stop();
  });

  it('forwards clicks with the cursor position at that moment, ignoring unknown buttons', async () => {
    const { session, fh, events, moveTo } = setup();
    await session.start({ cursor: false, clicks: true, keys: false });
    moveTo(300, 400);
    fh.fire('mousedown', { button: 1 });
    fh.fire('mousedown', { button: 2 });
    fh.fire('mousedown', { button: 3 });
    fh.fire('mousedown', { button: 4 });
    fh.fire('mousedown', {});
    expect(events).toEqual([
      { t: 'click', x: 300, y: 400, button: 'left' },
      { t: 'click', x: 300, y: 400, button: 'right' },
      { t: 'click', x: 300, y: 400, button: 'middle' },
    ]);
  });

  it('forwards only key labels (never raw key codes) and skips bare modifiers', async () => {
    const { session, fh, events } = setup();
    await session.start({ cursor: false, clicks: false, keys: true });
    fh.fire('keydown', key(31, { ctrlKey: true }));
    fh.fire('keydown', key(29, { ctrlKey: true }));
    fh.fire('keydown', key(30));
    expect(events).toEqual([{ t: 'key', text: 'Ctrl+S', combo: true }, { t: 'key', text: 'a', combo: false }]);
    for (const e of events) expect(Object.keys(e).sort()).toEqual(['combo', 't', 'text']);
  });

  it('polls the cursor only when it moved, and stops polling on stop', async () => {
    const { session, events, moveTo } = setup();
    await session.start({ cursor: true, clicks: false, keys: false });
    vi.advanceTimersByTime(50);
    expect(events).toEqual([{ t: 'cursor', x: 10, y: 20 }]);
    moveTo(11, 21);
    vi.advanceTimersByTime(25);
    expect(events).toHaveLength(2);
    session.stop();
    moveTo(50, 50);
    vi.advanceTimersByTime(100);
    expect(events).toHaveLength(2);
  });

  it('reports a clear message when the native module cannot load, and cursor effects still work', async () => {
    const { session, events } = setup({ load: { hook: null, error: 'Cannot find module uiohook-napi' } });
    const res = await session.start({ cursor: true, clicks: true, keys: true });
    expect(res.hookAvailable).toBe(false);
    expect(res.message).toContain('Cannot find module uiohook-napi');
    expect(res.message).toMatch(/ripples, auto-zoom and keystrokes are off/);
    expect(res.display).toEqual(DISPLAY);
    vi.advanceTimersByTime(20);
    expect(events.length).toBeGreaterThan(0);
    session.stop();
  });

  it('reports a hook that fails to start and leaves no listeners behind', async () => {
    const { session, fh } = setup({ failStart: true });
    const res = await session.start({ cursor: false, clicks: true, keys: true });
    expect(res.hookAvailable).toBe(false);
    expect(res.message).toContain('failed to start');
    expect(res.message).toContain('boom');
    expect(fh.count('mousedown') + fh.count('keydown')).toBe(0);
    session.stop();
    expect(fh.hook.stop).not.toHaveBeenCalled();
  });

  it('skips cursor effects and the mouse hook when the source is not a known screen, keys still work', async () => {
    const { session, fh, loadHook, events } = setup({ display: null });
    const res = await session.start({ cursor: true, clicks: true, keys: true });
    expect(res.display).toBeNull();
    expect(res.message).toMatch(/not a screen with a known position/);
    expect(fh.count('mousedown')).toBe(0);
    expect(fh.count('keydown')).toBe(1);
    vi.advanceTimersByTime(100);
    expect(events).toEqual([]); // no cursor polling without a display
    expect(loadHook).toHaveBeenCalledTimes(1);
    session.stop();
    const clicksOnly = setup({ display: null });
    await clicksOnly.session.start({ cursor: false, clicks: true, keys: false });
    expect(clicksOnly.loadHook).not.toHaveBeenCalled();
  });

  it('a stop while the display is still being resolved cancels the start', async () => {
    const fh = fakeHook();
    let resolve!: (d: DisplayInfo) => void;
    const session = createInputSession({
      loadHook: () => ({ hook: fh.hook, error: null }),
      cursorPoint: () => ({ x: 0, y: 0 }),
      emit: () => undefined,
      resolveDisplay: () => new Promise((r) => { resolve = r; }),
    });
    const p = session.start({ cursor: true, clicks: true, keys: true });
    session.stop();
    resolve(DISPLAY);
    const res = await p;
    expect(res.hookAvailable).toBe(false);
    expect(fh.hook.start).not.toHaveBeenCalled();
    expect(session.active()).toBe(false);
  });

  it('survives a throwing display lookup and a throwing emit', async () => {
    const fh = fakeHook();
    const session = createInputSession({
      loadHook: () => ({ hook: fh.hook, error: null }),
      cursorPoint: () => ({ x: 0, y: 0 }),
      emit: () => { throw new Error('window gone'); },
      resolveDisplay: async () => { throw new Error('no displays'); },
    });
    const res = await session.start({ cursor: false, clicks: false, keys: true });
    expect(res.display).toBeNull();
    expect(() => fh.fire('keydown', key(30))).not.toThrow();
    session.stop();
  });

  it('starting again replaces the previous run (one hook, no stacked listeners)', async () => {
    const { session, fh } = setup();
    await session.start({ cursor: false, clicks: true, keys: true });
    await session.start({ cursor: false, clicks: true, keys: true });
    expect(fh.count('mousedown')).toBe(1);
    expect(fh.count('keydown')).toBe(1);
    expect(fh.hook.stop).toHaveBeenCalledTimes(1);
    expect(fh.hook.start).toHaveBeenCalledTimes(2);
  });
});

describe('input session fallback display (manual zoom)', () => {
  it('uses the guessed display for cursor polling but never for clicks, and flags it approximate', async () => {
    vi.useFakeTimers();
    const fh = fakeHook();
    const events: InputEvent[] = [];
    const session = createInputSession({
      loadHook: () => ({ hook: fh.hook, error: null }),
      cursorPoint: () => ({ x: 5, y: 6 }),
      emit: (e) => events.push(e),
      resolveDisplay: async () => null,
      fallbackDisplay: () => DISPLAY,
      pollMs: 10,
    });
    const res = await session.start({ cursor: true, clicks: true, keys: false });
    expect(res.display).toBe(DISPLAY);
    expect(res.approximate).toBe(true);
    expect(fh.count('mousedown')).toBe(0);
    vi.advanceTimersByTime(30);
    expect(events.some((e) => e.t === 'cursor')).toBe(true);
    session.stop();
    vi.useRealTimers();
  });
});
