import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';
import { effectiveTheme, nextTheme, sanitizeTheme } from '../src/shared/theme';

describe('theme helpers', () => {
  it('resolves the effective theme', () => {
    expect(effectiveTheme('system', true)).toBe('light');
    expect(effectiveTheme('system', false)).toBe('dark');
    expect(effectiveTheme('dark', true)).toBe('dark');
    expect(effectiveTheme('light', false)).toBe('light');
  });
  it('toggles to the opposite of what is shown', () => {
    expect(nextTheme('system', true)).toBe('dark');
    expect(nextTheme('system', false)).toBe('light');
    expect(nextTheme('dark', true)).toBe('light');
    expect(nextTheme('light', false)).toBe('dark');
  });
  it('sanitizes the preference', () => {
    expect(sanitizeTheme('light')).toBe('light');
    expect(sanitizeTheme('dark')).toBe('dark');
    expect(sanitizeTheme('purple')).toBe('system');
    expect(sanitizeTheme(3)).toBe('system');
    expect(sanitizeTheme(undefined)).toBe('system');
  });
  it('settings: default for old files, valid value kept, junk rejected', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(sanitizeSettings({ version: 1 }).theme).toBe('system');
    expect(sanitizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(sanitizeSettings({ theme: 'neon' }).theme).toBe('system');
  });
});
