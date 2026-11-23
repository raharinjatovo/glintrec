/** One shown key: label and arrival time (ms, any monotonic clock). Lives in a short in-memory ring only. */
export interface KeyEntry { text: string; combo: boolean; at: number }

export const KEY_RING_SIZE = 16;
export const KEY_TTL_MS = 2200;
export const KEY_FADE_MS = 500;
export const KEY_MAX_CHARS = 28;

/**
 * What the pill shows at `now`: recent plain characters are merged into one string, shortcuts stand
 * alone, everything is joined with spaces and shortened from the left. alpha fades over the last
 * `fadeMs` of the newest key's life. null when nothing is recent enough.
 */
export function visibleKeys(
  entries: KeyEntry[], now: number, ttlMs = KEY_TTL_MS, fadeMs = KEY_FADE_MS, maxChars = KEY_MAX_CHARS,
): { text: string; alpha: number } | null {
  const age = (e: KeyEntry) => Math.max(0, now - e.at);
  const recent = entries.filter((e) => Number.isFinite(e.at) && typeof e.text === 'string' && age(e) < ttlMs);
  if (recent.length === 0) return null;
  const parts: string[] = [];
  let typing = false;
  for (const e of recent) {
    if (!e.combo && typing) parts[parts.length - 1] += e.text;
    else parts.push(e.text);
    typing = !e.combo;
  }
  let text = parts.join('  ');
  if (text.length > maxChars) text = '…' + text.slice(text.length - maxChars + 1);
  if (text.trim().length === 0) return null;
  const remaining = ttlMs - age(recent[recent.length - 1]);
  return { text, alpha: fadeMs > 0 ? Math.min(1, Math.max(0, remaining / fadeMs)) : 1 };
}
