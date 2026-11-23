import type { StrokeUpdate } from './annotation-strokes';

/** Timer functions, injectable so the throttle can be tested without real time. */
export interface StrokeTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface StrokeSender {
  /** A new stroke starts (the previous one, if any, is flushed first). `pts` is the live normalized list, read later. */
  begin(meta: { id: number; color: string; width: number }, pts: number[]): void;
  /** Points were appended to the live list: schedule a send (at most one per interval). */
  changed(): void;
  /** Pen up / cancel: send whatever is still unsent right away. */
  end(): void;
  /** Drop the stroke without sending anything (Clear). */
  cancel(): void;
}

/**
 * Throttled, append-only sender for the stroke being drawn. The first message of a stroke has from = 0, later ones
 * carry only the points added since the previous message (see StrokeUpdate). Nothing is sent when nothing is new.
 */
export function createStrokeSender(send: (u: StrokeUpdate) => void, intervalMs: number, timers: StrokeTimers): StrokeSender {
  let meta: { id: number; color: string; width: number } | null = null;
  let live: number[] = [];
  let sent = 0;
  let handle: unknown = null;

  const stop = () => { if (handle !== null) { timers.clear(handle); handle = null; } };
  const flush = () => {
    stop();
    if (!meta || live.length <= sent) return;
    const pts = live.slice(sent);
    send({ id: meta.id, color: meta.color, width: meta.width, pts, from: sent });
    sent += pts.length;
  };
  return {
    begin(m, pts) { flush(); meta = m; live = pts; sent = 0; },
    changed() { if (meta && handle === null) handle = timers.set(() => { handle = null; flush(); }, intervalMs); },
    end() { flush(); meta = null; live = []; sent = 0; },
    cancel() { stop(); meta = null; live = []; sent = 0; },
  };
}
