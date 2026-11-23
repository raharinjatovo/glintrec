import { describe, expect, it } from 'vitest';
import { modeAfterEscape, modeAfterHotkey } from '../src/shared/annotation';
import { parseInputEvent, parseInputRequest } from '../src/shared/input-events';
import { KEY_MAX_CHARS, KEY_TTL_MS, visibleKeys, type KeyEntry } from '../src/shared/key-display';
import { formatKeyEvent } from '../src/shared/key-labels';
import { addRipple, MAX_RIPPLES, pruneRipples, RIPPLE_MS, rippleFrame, type Ripple } from '../src/shared/ripples';
import { createRing } from '../src/shared/ring-buffer';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from '../src/shared/hotkeys';

describe('ring buffer', () => {
  it('keeps the newest entries, oldest first', () => {
    const r = createRing<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => r.push(n));
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.size).toBe(3);
    r.push(6);
    expect(r.toArray()).toEqual([4, 5, 6]);
  });
  it('clears completely and survives bad capacities', () => {
    const r = createRing<string>(2);
    r.push('a');
    r.clear();
    expect(r.toArray()).toEqual([]);
    r.push('b');
    expect(r.toArray()).toEqual(['b']);
    for (const cap of [0, -4, NaN, 0.4]) {
      const one = createRing<number>(cap);
      one.push(1); one.push(2);
      expect(one.toArray()).toEqual([2]);
    }
  });
});

describe('ripples', () => {
  const r = (at: number): Ripple => ({ x: 1, y: 2, at, button: 'left' });
  it('caps the list, dropping the oldest, and ignores invalid ripples', () => {
    let list: Ripple[] = [];
    for (let i = 0; i < MAX_RIPPLES + 5; i++) list = addRipple(list, r(i));
    expect(list).toHaveLength(MAX_RIPPLES);
    expect(list[0].at).toBe(5);
    expect(addRipple(list, { x: NaN, y: 0, at: 0, button: 'left' })).toBe(list);
    expect(addRipple(list, { x: 0, y: 0, at: Infinity, button: 'left' })).toBe(list);
  });
  it('prunes finished ripples and keeps the same array when nothing expired', () => {
    const list = [r(0), r(500)];
    expect(pruneRipples(list, 600)).toBe(list);
    expect(pruneRipples(list, RIPPLE_MS + 10)).toEqual([r(500)]);
  });
  it('animates radius up and alpha down; null outside the animation window', () => {
    const a = rippleFrame(r(0), 100, 40)!;
    const b = rippleFrame(r(0), 400, 40)!;
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(b.alpha).toBeLessThan(a.alpha);
    expect(b.radius).toBeLessThanOrEqual(40);
    expect(rippleFrame(r(0), RIPPLE_MS, 40)).toBeNull();
    expect(rippleFrame(r(1000), 500, 40)).toBeNull(); // starts in the future (clock skew)
    expect(rippleFrame(r(0), 100, 0)).toBeNull();
    expect(rippleFrame(r(0), NaN, 40)).toBeNull();
  });
});

describe('formatKeyEvent', () => {
  const k = (keycode: number, o: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) =>
    formatKeyEvent({ keycode, ctrl: false, alt: false, shift: false, meta: false, ...o });
  it('plain characters are text, shift upper-cases letters', () => {
    expect(k(30)).toEqual({ text: 'a', combo: false });
    expect(k(30, { shift: true })).toEqual({ text: 'A', combo: false });
    expect(k(11)).toEqual({ text: '0', combo: false });
    expect(k(57)).toEqual({ text: ' ', combo: false });
    expect(k(57, { shift: true })).toEqual({ text: ' ', combo: false });
  });
  it('shortcuts and named keys are combos', () => {
    expect(k(31, { ctrl: true })).toEqual({ text: 'Ctrl+S', combo: true });
    expect(k(44, { ctrl: true, shift: true })).toEqual({ text: 'Ctrl+Shift+Z', combo: true });
    expect(k(63, { alt: true, meta: true })).toEqual({ text: 'Alt+Win+F5', combo: true });
    expect(k(28)).toEqual({ text: 'Enter', combo: true });
    expect(k(1, { ctrl: true, shift: true })).toEqual({ text: 'Ctrl+Shift+Esc', combo: true });
    expect(k(57, { ctrl: true })).toEqual({ text: 'Ctrl+Space', combo: true });
    expect(k(78, { ctrl: true })).toEqual({ text: 'Ctrl++', combo: true });
  });
  it('shifted digits/punctuation depend on the layout, so they are labelled with Shift', () => {
    expect(k(2, { shift: true })).toEqual({ text: 'Shift+1', combo: true });
  });
  it('ignores modifier-only presses, unknown keys and garbage', () => {
    for (const code of [29, 3613, 56, 3640, 42, 54, 3675, 3676]) expect(k(code, { ctrl: true })).toBeNull();
    expect(k(99999)).toBeNull();
    expect(k(-1)).toBeNull();
    expect(formatKeyEvent(null as never)).toBeNull();
    expect(formatKeyEvent({ keycode: 'a' as never, ctrl: false, alt: false, shift: false, meta: false })).toBeNull();
  });
});

describe('visibleKeys', () => {
  const e = (text: string, at: number, combo = false): KeyEntry => ({ text, combo, at });
  it('merges typed characters and keeps shortcuts as separate pieces', () => {
    const list = [e('h', 0), e('i', 10), e('Ctrl+S', 20, true), e('x', 30)];
    expect(visibleKeys(list, 40)!.text).toBe('hi  Ctrl+S  x');
  });
  it('drops entries older than the ttl and returns null when nothing is recent', () => {
    const list = [e('a', 0), e('b', 1500)];
    expect(visibleKeys(list, KEY_TTL_MS + 100)!.text).toBe('b');
    expect(visibleKeys(list, 10_000)).toBeNull();
    expect(visibleKeys([], 0)).toBeNull();
  });
  it('fades over the end of the newest key and is opaque before that', () => {
    expect(visibleKeys([e('a', 0)], 100)!.alpha).toBe(1);
    const late = visibleKeys([e('a', 0)], KEY_TTL_MS - 100)!.alpha;
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
  });
  it('shortens long text from the left, ignores whitespace-only and malformed entries', () => {
    const long = Array.from({ length: 60 }, (_, i) => e(String.fromCharCode(97 + (i % 26)), i));
    const t = visibleKeys(long, 61)!.text;
    expect(t.length).toBe(KEY_MAX_CHARS);
    expect(t.startsWith('…')).toBe(true);
    expect(visibleKeys([e(' ', 0), e(' ', 1)], 2)).toBeNull();
    expect(visibleKeys([{ text: 5, combo: false, at: 0 } as never, e('z', NaN)], 1)).toBeNull();
  });
  it('treats an entry from the future (clock skew) as brand new', () => {
    expect(visibleKeys([e('a', 500)], 100)!.alpha).toBe(1);
  });
});

describe('input payload validation', () => {
  it('parseInputRequest needs an object and treats non-booleans as off', () => {
    for (const raw of [null, undefined, 5, 'x', [], [true]]) expect(parseInputRequest(raw)).toBeNull();
    expect(parseInputRequest({})).toEqual({ cursor: false, clicks: false, keys: false });
    expect(parseInputRequest({ cursor: 1, clicks: 'true', keys: true })).toEqual({ cursor: false, clicks: false, keys: true });
  });
  it('parseInputEvent accepts only well-formed events', () => {
    expect(parseInputEvent({ t: 'cursor', x: 1, y: 2 })).toEqual({ t: 'cursor', x: 1, y: 2 });
    expect(parseInputEvent({ t: 'click', x: 1, y: 2, button: 'right' })).toEqual({ t: 'click', x: 1, y: 2, button: 'right' });
    expect(parseInputEvent({ t: 'key', text: 'Ctrl+S', combo: true })).toEqual({ t: 'key', text: 'Ctrl+S', combo: true });
    expect(parseInputEvent({ t: 'key', text: 'a', combo: 'yes' })).toEqual({ t: 'key', text: 'a', combo: false });
    for (const bad of [
      null, 7, 'x', {}, { t: 'nope' }, { t: 'cursor', x: NaN, y: 1 }, { t: 'cursor', x: '1', y: 1 },
      { t: 'click', x: 1, y: 2, button: 'back' }, { t: 'click', x: 1, y: 2 },
      { t: 'key', text: '' }, { t: 'key', text: 5 }, { t: 'key', text: 'x'.repeat(65) },
    ]) expect(parseInputEvent(bad)).toBeNull();
  });
});

describe('annotation modes', () => {
  it('hotkey: closed -> draw -> closed, passthrough -> draw; Esc: draw -> passthrough only', () => {
    expect(modeAfterHotkey('closed')).toBe('draw');
    expect(modeAfterHotkey('draw')).toBe('closed');
    expect(modeAfterHotkey('passthrough')).toBe('draw');
    expect(modeAfterEscape('draw')).toBe('passthrough');
    expect(modeAfterEscape('passthrough')).toBe('passthrough');
    expect(modeAfterEscape('closed')).toBe('closed');
  });
});

describe('effects settings and the annotate hotkey', () => {
  it('defaults are conservative: everything off', () => {
    expect(DEFAULT_SETTINGS.effects).toEqual({ cursorHighlight: false, clickRipples: false, keystrokes: false, autoZoom: 1, zoomHud: true });
    expect(sanitizeSettings({}).effects).toEqual(DEFAULT_SETTINGS.effects);
  });
  it('keeps valid values and falls back for garbage', () => {
    expect(sanitizeSettings({ effects: { cursorHighlight: true, clickRipples: true, keystrokes: true, autoZoom: 1.5 } }).effects)
      .toEqual({ cursorHighlight: true, clickRipples: true, keystrokes: true, autoZoom: 1.5, zoomHud: true });
    expect(sanitizeSettings({ effects: { autoZoom: 2 } }).effects.autoZoom).toBe(2);
    for (const z of [3, 0, -1, '2', NaN, null, 1.4, 99]) expect(sanitizeSettings({ effects: { autoZoom: z } }).effects.autoZoom).toBe(1);
    const bad = sanitizeSettings({ effects: { cursorHighlight: 'yes', keystrokes: 1, clickRipples: null } }).effects;
    expect(bad).toEqual(DEFAULT_SETTINGS.effects);
    for (const raw of [null, 5, 'x', [], [1]]) expect(sanitizeSettings({ effects: raw }).effects).toEqual(DEFAULT_SETTINGS.effects);
  });
  it('keystrokes can never be switched on by a non-boolean value', () => {
    expect(sanitizeSettings({ effects: { keystrokes: 'true' } }).effects.keystrokes).toBe(false);
    expect(sanitizeSettings({ effects: { keystrokes: 1 } }).effects.keystrokes).toBe(false);
  });
  it('annotate hotkey is rebindable, can be disabled, and conflicts disable the later action', () => {
    expect(DEFAULT_HOTKEYS.annotate).toBe('CommandOrControl+Shift+D');
    expect(sanitizeHotkeys({ annotate: 'ctrl+alt+d' }).annotate).toBe('Control+Alt+D');
    expect(sanitizeHotkeys({ annotate: '' }).annotate).toBe('');
    expect(sanitizeHotkeys({ annotate: 'nope' }).annotate).toBe(DEFAULT_HOTKEYS.annotate);
    expect(sanitizeHotkeys({ toggle: 'Ctrl+K', annotate: 'ctrl+k' }).annotate).toBe('');
    expect(sanitizeHotkeys({ toggle: 'F5', pause: 'F6', screenshot: 'F7' }).annotate).toBe(DEFAULT_HOTKEYS.annotate);
  });
});
