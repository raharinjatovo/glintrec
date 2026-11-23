import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenerationGuard, stopRecorder, type StoppableRecorder } from '../src/shared/async-guards';

describe('createGenerationGuard', () => {
  it('only the latest generation is current', () => {
    const g = createGenerationGuard();
    const a = g.next();
    expect(g.isCurrent(a)).toBe(true);
    const b = g.next();
    expect(g.isCurrent(a)).toBe(false);
    expect(g.isCurrent(b)).toBe(true);
  });

  it('lets a caller discard a stale async result (camera race)', async () => {
    const g = createGenerationGuard();
    const stopped: string[] = [];
    let kept: string | null = null;
    const open = async (name: string, delay: number) => {
      const gen = g.next();
      await new Promise((r) => setTimeout(r, delay));
      if (!g.isCurrent(gen)) { stopped.push(name); return; }
      kept = name;
    };
    await Promise.all([open('first', 20), open('second', 1)]);
    expect(kept).toBe('second');
    expect(stopped).toEqual(['first']);
  });
});

function fakeRecorder(state = 'recording') {
  const handlers: Record<string, Array<() => void>> = { stop: [], error: [] };
  const r: StoppableRecorder & { fire(t: 'stop' | 'error'): void; stopCalls: number } = {
    state,
    stopCalls: 0,
    stop() { r.stopCalls++; },
    addEventListener(t, fn) { handlers[t].push(fn); },
    removeEventListener(t, fn) { handlers[t] = handlers[t].filter((h) => h !== fn); },
    fire(t) { [...handlers[t]].forEach((h) => h()); },
  };
  return { r, handlers };
}

describe('stopRecorder', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves immediately when already inactive', async () => {
    const { r } = fakeRecorder('inactive');
    expect(await stopRecorder(r, 1000)).toBe('stopped');
    expect(r.stopCalls).toBe(0);
  });
  it('resolves stopped on the stop event and cleans listeners', async () => {
    const { r, handlers } = fakeRecorder();
    const p = stopRecorder(r, 1000);
    expect(r.stopCalls).toBe(1);
    r.fire('stop');
    expect(await p).toBe('stopped');
    expect(handlers.stop).toHaveLength(0);
    expect(handlers.error).toHaveLength(0);
  });
  it('resolves error on the error event', async () => {
    const { r } = fakeRecorder();
    const p = stopRecorder(r, 1000);
    r.fire('error');
    expect(await p).toBe('error');
  });
  it('resolves timeout when no event arrives', async () => {
    const { r } = fakeRecorder();
    const p = stopRecorder(r, 10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toBe('timeout');
  });
  it('resolves error when stop() throws', async () => {
    const { r } = fakeRecorder();
    r.stop = () => { throw new Error('InvalidStateError'); };
    expect(await stopRecorder(r, 1000)).toBe('error');
  });
  it('does not time out after an early stop', async () => {
    const { r } = fakeRecorder();
    const p = stopRecorder(r, 1000);
    r.fire('stop');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe('stopped');
  });
});
