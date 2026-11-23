/** Fixed-capacity buffer that overwrites its oldest entry; memory only, nothing is ever written out. */
export interface Ring<T> {
  push(v: T): void;
  /** Oldest first. */
  toArray(): T[];
  clear(): void;
  readonly size: number;
}

export function createRing<T>(capacity: number): Ring<T> {
  const cap = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1;
  const buf: T[] = [];
  let head = 0;
  return {
    push(v) {
      if (buf.length < cap) buf.push(v);
      else { buf[head] = v; head = (head + 1) % cap; }
    },
    toArray: () => [...buf.slice(head), ...buf.slice(0, head)],
    clear() { buf.length = 0; head = 0; },
    get size() { return buf.length; },
  };
}
