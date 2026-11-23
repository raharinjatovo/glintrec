/** Key event as the hook reports it (modifier state included); nothing here is ever stored or logged. */
export interface KeyInput { keycode: number; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
/** `combo`: a shortcut or a named key (Ctrl+S, Enter); plain typed characters have combo = false. */
export interface KeyLabel { text: string; combo: boolean }

// Hook key codes (libuiohook scancodes). Letters follow the virtual key of the active layout; punctuation
// and digits are labelled by the physical key, so they can differ from what the layout types.
const LETTERS: Record<number, string> = {
  30: 'a', 48: 'b', 46: 'c', 32: 'd', 18: 'e', 33: 'f', 34: 'g', 35: 'h', 23: 'i', 36: 'j', 37: 'k', 38: 'l', 50: 'm',
  49: 'n', 24: 'o', 25: 'p', 16: 'q', 19: 'r', 31: 's', 20: 't', 22: 'u', 47: 'v', 17: 'w', 44: 'z', 21: 'y', 45: 'x',
};
const DIGITS: Record<number, string> = {
  11: '0', 2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9',
  82: '0', 79: '1', 80: '2', 81: '3', 75: '4', 76: '5', 77: '6', 71: '7', 72: '8', 73: '9',
};
const PUNCT: Record<number, string> = {
  39: ';', 13: '=', 51: ',', 12: '-', 52: '.', 53: '/', 41: '`', 26: '[', 43: '\\', 27: ']', 40: "'",
  55: '*', 78: '+', 74: '-', 83: '.', 3637: '/',
};
const NAMED: Record<number, string> = {
  14: 'Backspace', 15: 'Tab', 28: 'Enter', 1: 'Esc', 3657: 'PgUp', 3665: 'PgDn', 3663: 'End', 3655: 'Home',
  57419: 'Left', 57416: 'Up', 57421: 'Right', 57424: 'Down', 3666: 'Insert', 3667: 'Delete', 58: 'CapsLock',
  3639: 'PrintScreen',
};
const FKEYS: Record<number, string> = {
  59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6', 65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10', 87: 'F11', 88: 'F12',
};
/** Pure modifier keys: only shown as part of a combination, never on their own. */
const MODIFIERS = new Set([29, 3613, 56, 3640, 42, 54, 3675, 3676]);
const SPACE = 57;

function modifierPrefix(e: KeyInput): string {
  return [e.ctrl && 'Ctrl', e.alt && 'Alt', e.shift && 'Shift', e.meta && 'Win'].filter(Boolean).join('+');
}

/**
 * Label to show for a key press: null for modifier-only presses and unknown keys. Printable characters
 * without Ctrl/Alt/Win are plain text ("a", "A" with Shift); everything else is a combo ("Ctrl+S", "Enter").
 * Shift on digits/punctuation is shown as "Shift+1": the shifted character depends on the keyboard layout.
 */
export function formatKeyEvent(e: KeyInput): KeyLabel | null {
  if (!e || typeof e.keycode !== 'number' || MODIFIERS.has(e.keycode)) return null;
  const letter = LETTERS[e.keycode];
  const ch = letter ?? DIGITS[e.keycode] ?? PUNCT[e.keycode] ?? (e.keycode === SPACE ? ' ' : undefined);
  const shortcut = e.ctrl || e.alt || e.meta;
  if (ch !== undefined && !shortcut && (!e.shift || letter !== undefined || ch === ' ')) {
    return { text: e.shift ? ch.toUpperCase() : ch, combo: false };
  }
  const name = ch !== undefined ? (ch === ' ' ? 'Space' : ch.toUpperCase()) : NAMED[e.keycode] ?? FKEYS[e.keycode];
  if (!name) return null;
  const mods = modifierPrefix(e);
  return { text: mods ? `${mods}+${name}` : name, combo: true };
}
