import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { formatKeyEvent } from '../src/shared/key-labels';

// Cross-check the hand-written key table against the real uiohook-napi key codes (skipped if it cannot load).
function loadKeys(): Record<string, number> | null {
  try {
    return (createRequire(import.meta.url)('uiohook-napi') as { UiohookKey: Record<string, number> }).UiohookKey;
  } catch {
    return null;
  }
}
const keys = loadKeys();
const label = (code: number) => formatKeyEvent({ keycode: code, ctrl: false, alt: false, shift: false, meta: false });

describe.skipIf(!keys)('key table matches uiohook-napi', () => {
  it('letters, digits and common punctuation', () => {
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(label(keys![l])).toEqual({ text: l.toLowerCase(), combo: false });
    for (let d = 0; d <= 9; d++) {
      expect(label(keys![String(d)])).toEqual({ text: String(d), combo: false });
      expect(label(keys![`Numpad${d}`])).toEqual({ text: String(d), combo: false });
    }
    expect(label(keys!.Semicolon)!.text).toBe(';');
    expect(label(keys!.Slash)!.text).toBe('/');
    expect(label(keys!.Space)!.text).toBe(' ');
  });
  it('named keys, function keys and modifiers', () => {
    for (const [name, text] of [['Enter', 'Enter'], ['Backspace', 'Backspace'], ['Tab', 'Tab'], ['Escape', 'Esc'], ['ArrowLeft', 'Left'],
      ['ArrowUp', 'Up'], ['ArrowRight', 'Right'], ['ArrowDown', 'Down'], ['Delete', 'Delete'], ['Home', 'Home'], ['End', 'End'],
      ['PageUp', 'PgUp'], ['PageDown', 'PgDn'], ['F1', 'F1'], ['F5', 'F5'], ['F12', 'F12']] as const) {
      expect(label(keys![name])).toEqual({ text, combo: true });
    }
    for (const m of ['Ctrl', 'CtrlRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight', 'Meta', 'MetaRight']) expect(label(keys![m])).toBeNull();
  });
});
