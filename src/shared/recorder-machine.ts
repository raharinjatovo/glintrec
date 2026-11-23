import { formatElapsed } from './format';
export { formatElapsed };

export type RecState =
  | { phase: 'idle' }
  | { phase: 'countdown'; remaining: number }
  | { phase: 'recording' }
  | { phase: 'paused' }
  | { phase: 'stopping' };
export type RecEvent =
  | { type: 'START'; countdownFrom?: number }
  | { type: 'TICK' }
  | { type: 'CANCEL' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'STOPPED' };

export function initialState(): RecState {
  return { phase: 'idle' };
}

export function reduce(state: RecState, ev: RecEvent): RecState {
  switch (ev.type) {
    case 'START': {
      if (state.phase !== 'idle') return state;
      const from = ev.countdownFrom ?? 3;
      return from > 0 ? { phase: 'countdown', remaining: Math.floor(from) } : { phase: 'recording' };
    }
    case 'TICK':
      if (state.phase !== 'countdown') return state;
      return state.remaining <= 1 ? { phase: 'recording' } : { phase: 'countdown', remaining: state.remaining - 1 };
    case 'CANCEL':
      return state.phase === 'countdown' ? { phase: 'idle' } : state;
    case 'PAUSE':
      return state.phase === 'recording' ? { phase: 'paused' } : state;
    case 'RESUME':
      return state.phase === 'paused' ? { phase: 'recording' } : state;
    case 'STOP':
      return state.phase === 'recording' || state.phase === 'paused' ? { phase: 'stopping' } : state;
    case 'STOPPED':
      return state.phase === 'stopping' ? { phase: 'idle' } : state;
    default:
      return state;
  }
}

export interface ElapsedClock {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  reset(): void;
  elapsedMs(): number;
}

export function createElapsedClock(now: () => number): ElapsedClock {
  let acc = 0;
  let runningSince: number | null = null;
  const settle = () => {
    if (runningSince !== null) {
      acc += now() - runningSince;
      runningSince = null;
    }
  };
  return {
    start() { acc = 0; runningSince = now(); },
    pause() { settle(); },
    resume() { if (runningSince === null) runningSince = now(); },
    stop() { settle(); },
    reset() { acc = 0; runningSince = null; },
    elapsedMs() { return runningSince !== null ? acc + (now() - runningSince) : acc; },
  };
}
