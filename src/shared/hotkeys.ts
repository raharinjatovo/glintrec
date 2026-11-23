import type { HotkeyAction, HotkeySettings } from './ipc';

export const HOTKEY_ACTIONS: HotkeyAction[] = ['toggle', 'pause', 'screenshot', 'annotate', 'zoomIn', 'zoomOut', 'zoomReset', 'toggleCamera'];

export const DEFAULT_HOTKEYS: HotkeySettings = {
  toggle: 'CommandOrControl+Shift+R',
  pause: 'CommandOrControl+Shift+P',
  screenshot: 'CommandOrControl+Shift+S',
  annotate: 'CommandOrControl+Shift+D',
  // Ctrl+Alt is AltGr on some keyboard layouts; users can rebind in the settings.
  // Not Ctrl+Plus/Minus/0 variants: those are the browser's own zoom keys and would also zoom whatever window has focus.
  zoomIn: 'Control+Alt+PageUp',
  zoomOut: 'Control+Alt+PageDown',
  zoomReset: 'Control+Alt+Home',
  // Camera only <-> screen + camera, also during a recording. Ctrl+Alt+F9: no browser/Windows/common-app use, not an AltGr
  // character on EU layouts, and not an Intel graphics shortcut (those are Ctrl+Alt+arrows/F12).
  toggleCamera: 'Control+Alt+F9',
};

/**
 * Earlier default combos (zoom: Plus/-/0 are unreachable on AZERTY with Ctrl+Alt = AltGr, and clash with the browser zoom; camera: Ctrl+Alt+C).
 * A saved settings.json still holding one of them is migrated to the current default instead of keeping a dead shortcut.
 */
const LEGACY_ZOOM_DEFAULTS: Partial<Record<HotkeyAction, string[]>> = {
  zoomIn: ['Control+Alt+Plus', 'CommandOrControl+Plus', 'Control+Plus', 'CommandOrControl+Alt+Plus'],
  zoomOut: ['Control+Alt+-', 'CommandOrControl+-', 'Control+-', 'CommandOrControl+Alt+-'],
  zoomReset: ['Control+Alt+0', 'CommandOrControl+0', 'Control+0', 'CommandOrControl+Alt+0'],
  // Ctrl+Alt+C is AltGr+C (a character) on several layouts.
  toggleCamera: ['Control+Alt+C'],
};

/** Canonical modifier names in the order they are written back (so equal combos compare equal). */
const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Control', 'Alt', 'AltGr', 'Shift', 'Super', 'Meta'];
const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl',
  command: 'Command', cmd: 'Command',
  control: 'Control', ctrl: 'Control',
  alt: 'Alt', option: 'Alt', altgr: 'AltGr',
  shift: 'Shift', super: 'Super', meta: 'Meta',
};

const NAMED_KEYS = [
  'Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete', 'Insert', 'Return',
  'Enter', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc',
  'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop',
  'MediaPlayPause', 'PrintScreen',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
];
const NAMED_KEY_MAP = new Map(NAMED_KEYS.map((k) => [k.toLowerCase(), k]));
const PUNCTUATION = new Set('`~!@#$%^&*()-_=[]{}\\|;:\'",.<>/?'.split(''));

function canonicalKey(part: string): string | null {
  if (/^[A-Za-z0-9]$/.test(part)) return part.toUpperCase();
  if (/^[Ff]([1-9]|1\d|2[0-4])$/.test(part)) return part.toUpperCase();
  if (PUNCTUATION.has(part)) return part;
  return NAMED_KEY_MAP.get(part.toLowerCase()) ?? null;
}

/**
 * Validate an Electron accelerator ("Ctrl+Shift+R") and return its canonical form, or null when it is
 * not usable. Exactly one key is required, plus at least one non-Shift modifier unless the key is F1-F24: a
 * bare letter as a global shortcut would swallow normal typing in every application.
 */
export function validateAccelerator(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const parts = raw.split('+').map((p) => p.trim());
  if (parts.length < 1 || parts.some((p) => p.length === 0)) return null;
  const key = canonicalKey(parts[parts.length - 1]);
  if (!key) return null;
  const mods = new Set<string>();
  for (const p of parts.slice(0, -1)) {
    const m = MODIFIER_ALIASES[p.toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const hasRealMod = [...mods].some((m) => m !== 'Shift');
  if (!hasRealMod && !/^F\d+$/.test(key)) return null;
  const ordered = MODIFIER_ORDER.filter((m) => mods.has(m));
  return [...ordered, key].join('+');
}

/**
 * Per action: a valid accelerator is kept (canonicalized), '' means disabled, anything else falls back
 * to the default. When two actions end up on the same combo the later one is disabled.
 */
export function sanitizeHotkeys(raw: unknown): HotkeySettings {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: HotkeySettings = { ...DEFAULT_HOTKEYS };
  const used = new Set<string>();
  for (const action of HOTKEY_ACTIONS) {
    const v = r[action];
    let acc = v === '' ? '' : validateAccelerator(v) ?? DEFAULT_HOTKEYS[action];
    if (acc && LEGACY_ZOOM_DEFAULTS[action]?.includes(acc)) acc = DEFAULT_HOTKEYS[action];
    if (acc && used.has(acc)) acc = '';
    if (acc) used.add(acc);
    out[action] = acc;
  }
  return out;
}

/** The other action already bound to `accelerator` (canonical), if any. */
export function findHotkeyConflict(hotkeys: HotkeySettings, action: HotkeyAction, accelerator: string): HotkeyAction | null {
  if (!accelerator) return null;
  return HOTKEY_ACTIONS.find((a) => a !== action && hotkeys[a] === accelerator) ?? null;
}
