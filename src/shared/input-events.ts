import type { InputEvent, InputRequest, MouseButtonName } from './ipc';

const BUTTONS: MouseButtonName[] = ['left', 'right', 'middle'];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const MAX_KEY_TEXT = 64;

/** Validate an input:start payload: an object whose flags are strictly boolean (anything else = off), else null. */
export function parseInputRequest(raw: unknown): InputRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return { cursor: r.cursor === true, clicks: r.clicks === true, keys: r.keys === true };
}

/** Validate an event received from the main process before the renderer uses it; unusable events are null. */
export function parseInputEvent(raw: unknown): InputEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.t === 'cursor') return finite(r.x) && finite(r.y) ? { t: 'cursor', x: r.x, y: r.y } : null;
  if (r.t === 'click') {
    const button = BUTTONS.find((b) => b === r.button);
    return finite(r.x) && finite(r.y) && button ? { t: 'click', x: r.x, y: r.y, button } : null;
  }
  if (r.t === 'key') {
    return typeof r.text === 'string' && r.text.length > 0 && r.text.length <= MAX_KEY_TEXT
      ? { t: 'key', text: r.text, combo: r.combo === true } : null;
  }
  return null;
}
