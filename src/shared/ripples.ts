import type { MouseButtonName } from './ipc';

export const RIPPLE_MS = 650;
export const MAX_RIPPLES = 12;

/** A click animation: position in frame pixels, `at` = start time (ms, any monotonic clock). */
export interface Ripple { x: number; y: number; at: number; button: MouseButtonName }

/** New list with `r` appended, dropping the oldest entries beyond `max`. Invalid ripples are ignored. */
export function addRipple(list: Ripple[], r: Ripple, max = MAX_RIPPLES): Ripple[] {
  if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.at)) return list;
  const next = [...list, r];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function pruneRipples(list: Ripple[], now: number): Ripple[] {
  // No allocation in the common frame where nothing has expired (called every rendered frame).
  if (list.every((r) => now - r.at < RIPPLE_MS)) return list;
  return list.filter((r) => now - r.at < RIPPLE_MS);
}

/** Radius (grows ease-out) and alpha (fades linearly) at `now`; null before the start or after the end. */
export function rippleFrame(r: Ripple, now: number, maxRadius: number): { radius: number; alpha: number } | null {
  const t = (now - r.at) / RIPPLE_MS;
  if (!Number.isFinite(t) || t < 0 || t >= 1 || !(maxRadius > 0)) return null;
  const ease = 1 - Math.pow(1 - t, 3);
  return { radius: maxRadius * (0.25 + 0.75 * ease), alpha: 0.85 * (1 - t) };
}
