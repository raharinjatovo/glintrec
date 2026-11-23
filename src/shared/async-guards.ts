/** Generation counter: lets an async function detect that a newer call started while it awaited. */
export interface GenerationGuard {
  next(): number;
  isCurrent(gen: number): boolean;
}

export function createGenerationGuard(): GenerationGuard {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (gen) => gen === current,
  };
}

/** The slice of MediaRecorder that stopRecorder needs (kept minimal so it is testable without a DOM). */
export interface StoppableRecorder {
  state: string;
  stop(): void;
  addEventListener(type: 'stop' | 'error', fn: () => void, opts?: { once?: boolean }): void;
  removeEventListener(type: 'stop' | 'error', fn: () => void): void;
}

export type StopOutcome = 'stopped' | 'error' | 'timeout';

/**
 * Stop a recorder and wait for its 'stop' event, but never hang: an 'error' event or the
 * timeout ends the wait early so the caller can finish with whatever chunks were flushed.
 */
export function stopRecorder(r: StoppableRecorder, timeoutMs: number): Promise<StopOutcome> {
  if (r.state === 'inactive') return Promise.resolve('stopped');
  return new Promise<StopOutcome>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (outcome: StopOutcome) => () => {
      if (timer) clearTimeout(timer);
      r.removeEventListener('stop', onStop);
      r.removeEventListener('error', onError);
      resolve(outcome);
    };
    const onStop = done('stopped');
    const onError = done('error');
    r.addEventListener('stop', onStop, { once: true });
    r.addEventListener('error', onError, { once: true });
    timer = setTimeout(done('timeout'), timeoutMs);
    try {
      r.stop();
    } catch {
      onError();
    }
  });
}
