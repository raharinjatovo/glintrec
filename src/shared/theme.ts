import type { ThemePref } from './ipc';

export type EffectiveTheme = 'dark' | 'light';

export const THEME_PREFS: ThemePref[] = ['system', 'dark', 'light'];
export const DEFAULT_THEME: ThemePref = 'system';

export function sanitizeTheme(v: unknown): ThemePref {
  return typeof v === 'string' && (THEME_PREFS as string[]).includes(v) ? (v as ThemePref) : DEFAULT_THEME;
}

/** The palette actually shown: an explicit choice wins, 'system' follows the OS. */
export function effectiveTheme(pref: ThemePref, systemPrefersLight: boolean): EffectiveTheme {
  if (pref === 'system') return systemPrefersLight ? 'light' : 'dark';
  return pref;
}

/** Click on the toggle: always an explicit choice, the opposite of what is shown now. */
export function nextTheme(pref: ThemePref, systemPrefersLight: boolean): EffectiveTheme {
  return effectiveTheme(pref, systemPrefersLight) === 'light' ? 'dark' : 'light';
}
