import * as fs from 'node:fs';

/** Max size of the log file: once reached, further lines are dropped (the file is truncated again at every start). */
export const DEBUG_LOG_MAX_BYTES = 512 * 1024;

let file: string | null = null;
let written = 0;

/** Timestamped single line; arguments are stringified (objects as JSON, errors by message). */
export function formatLogLine(now: Date, args: readonly unknown[]): string {
  const text = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    try { return JSON.stringify(a) ?? String(a); } catch { return String(a); }
  }).join(' ');
  return `${now.toISOString()} ${text}\n`;
}

/** Truncates `path` and starts logging there. Never throws: logging must not break the app. */
export function initDebugLog(path: string): void {
  file = path;
  written = 0;
  try { fs.writeFileSync(path, formatLogLine(new Date(), ['--- log started']), 'utf8'); } catch { file = null; }
}

/** Appends one line to the log file (and mirrors it to the console). No-op on the file before initDebugLog. */
export function debugLog(...args: unknown[]): void {
  const line = formatLogLine(new Date(), args);
  try { console.log(line.trimEnd()); } catch { /* stdout may be closed */ }
  if (!file || written >= DEBUG_LOG_MAX_BYTES) return;
  written += line.length;
  try { fs.appendFileSync(file, line, 'utf8'); } catch { /* ignore */ }
}

/** Test helper. */
export function resetDebugLog(): void { file = null; written = 0; }
