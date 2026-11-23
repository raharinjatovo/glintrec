/** Shortest clip a trim may produce, in seconds. */
export const MIN_TRIM_SEC = 0.1;
/** Upper bound for any time value; rejects absurd input before it reaches ffmpeg arguments. */
export const MAX_TRIM_SEC = 24 * 3600;

export type TrimCheck = { ok: true; start: number; end: number } | { ok: false; message: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate and clamp a trim range. Times must be finite numbers; `duration` (optional, null/undefined =
 * unknown) clamps the range into the clip. The result always satisfies 0 <= start < end - MIN_TRIM_SEC.
 */
export function validateTrim(startRaw: unknown, endRaw: unknown, duration?: unknown): TrimCheck {
  if (!isNum(startRaw) || !isNum(endRaw)) return { ok: false, message: 'Start and end must be numbers' };
  let dur: number | null = null;
  if (duration !== undefined && duration !== null) {
    if (!isNum(duration) || duration <= 0) return { ok: false, message: 'Invalid duration' };
    dur = Math.min(duration, MAX_TRIM_SEC);
  }
  const ceiling = dur ?? MAX_TRIM_SEC;
  const start = Math.min(Math.max(startRaw, 0), ceiling);
  const end = Math.min(Math.max(endRaw, 0), ceiling);
  if (end - start < MIN_TRIM_SEC) return { ok: false, message: 'Start must be before end (at least 0.1 s apart)' };
  return { ok: true, start, end };
}

/** Parse "12.5", "1:05", "1:05.5" or "1:02:03" into seconds; null when it is not a plain time. */
export function parseTimeInput(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(?:\.\d+)?$|^(?:\d+:)?\d{1,2}:\d{1,2}(?:\.\d+)?$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
  return Number.isFinite(secs) && secs <= MAX_TRIM_SEC ? secs : null;
}

/** "m:ss.s" (or "h:mm:ss.s" from one hour up), tenths of a second. */
export function formatTrimTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.round(sec * 10) / 10 : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** File name (no directory) for the trimmed copy of `fileName`: "clip.webm" -> "clip-trim.mp4". */
export function trimmedFileName(fileName: string): string {
  const base = fileName.replace(/\.[^\\/.]*$/, '') || 'recording';
  return `${base}-trim.mp4`;
}
