import { describe, expect, it } from 'vitest';
import { captureModeLabel, liveSwitchDecision, nextCaptureMode } from '../src/shared/quick-toggles';

describe('quick toggles', () => {
  it('flips capture mode both ways', () => {
    expect(nextCaptureMode('screen')).toBe('camera');
    expect(nextCaptureMode('camera')).toBe('screen');
  });
  it('labels the current state', () => {
    expect(captureModeLabel('camera')).toBe('Camera only');
    expect(captureModeLabel('screen')).toBe('Screen + camera');
  });
});

describe('toggleCamera hotkey', () => {
  it('has a free default', async () => {
    const { DEFAULT_HOTKEYS, HOTKEY_ACTIONS } = await import('../src/shared/hotkeys');
    expect(DEFAULT_HOTKEYS.toggleCamera).toBe('Control+Alt+F9');
    const others = HOTKEY_ACTIONS.filter((a) => a !== 'toggleCamera').map((a) => DEFAULT_HOTKEYS[a]);
    expect(others).not.toContain(DEFAULT_HOTKEYS.toggleCamera);
  });
  it('old settings without the key get the default; empty disables; duplicates are dropped', async () => {
    const { DEFAULT_HOTKEYS, sanitizeHotkeys, findHotkeyConflict } = await import('../src/shared/hotkeys');
    expect(sanitizeHotkeys({ toggle: 'F9' }).toggleCamera).toBe(DEFAULT_HOTKEYS.toggleCamera);
    expect(sanitizeHotkeys({ toggleCamera: '' }).toggleCamera).toBe('');
    expect(sanitizeHotkeys({ toggleCamera: 'garbage' }).toggleCamera).toBe(DEFAULT_HOTKEYS.toggleCamera);
    expect(sanitizeHotkeys({ toggle: 'Ctrl+Alt+K', toggleCamera: 'alt+ctrl+k' }).toggleCamera).toBe('');
    expect(findHotkeyConflict(DEFAULT_HOTKEYS, 'pause', DEFAULT_HOTKEYS.toggleCamera)).toBe('toggleCamera');
  });
  it('accepts F9 with Ctrl+Alt and migrates the old default, keeping custom values', async () => {
    const { validateAccelerator, sanitizeHotkeys, DEFAULT_HOTKEYS } = await import('../src/shared/hotkeys');
    expect(validateAccelerator('Control+Alt+F9')).toBe('Control+Alt+F9');
    expect(sanitizeHotkeys({ toggleCamera: 'Control+Alt+C' }).toggleCamera).toBe('Control+Alt+F9');
    expect(sanitizeHotkeys({ toggleCamera: 'ctrl+alt+c' }).toggleCamera).toBe(DEFAULT_HOTKEYS.toggleCamera);
    expect(sanitizeHotkeys({ toggleCamera: 'Control+Alt+K' }).toggleCamera).toBe('Control+Alt+K');
    expect(sanitizeHotkeys({ pause: 'Control+Alt+F9' }).toggleCamera).toBe('');
  });
});

describe('liveSwitchDecision', () => {
  it('ignores non-recording phases', () => {
    for (const p of ['idle', 'countdown', 'stopping']) {
      expect(liveSwitchDecision(p, 'screen', true, true, true).allowed).toBe(false);
    }
  });
  it('screen -> camera, camera already on', () => {
    expect(liveSwitchDecision('recording', 'screen', true, true, true)).toEqual({
      allowed: true, nextMode: 'camera', needScreenStart: false, needCameraOpen: false, restoreCameraOff: false, message: 'Camera only' });
  });
  it('screen -> camera opens a camera that is off (paused works too)', () => {
    const d = liveSwitchDecision('paused', 'screen', true, true, false);
    expect(d.allowed && d.needCameraOpen).toBe(true);
  });
  it('camera -> screen reuses a running screen stream', () => {
    const d = liveSwitchDecision('recording', 'camera', true, true, true);
    expect(d).toMatchObject({ allowed: true, nextMode: 'screen', needScreenStart: false, restoreCameraOff: false, message: 'Screen + camera' });
  });
  it('camera -> screen starts the source when there is no stream', () => {
    expect(liveSwitchDecision('recording', 'camera', false, true, true).needScreenStart).toBe(true);
  });
  it('camera -> screen without stream or source is refused with a message', () => {
    expect(liveSwitchDecision('recording', 'camera', false, false, true)).toMatchObject({ allowed: false, nextMode: 'camera', message: 'Pick a screen source first' });
  });
  it('camera -> screen restores a camera that was only forced on', () => {
    expect(liveSwitchDecision('recording', 'camera', true, true, true, true).restoreCameraOff).toBe(true);
  });
});
