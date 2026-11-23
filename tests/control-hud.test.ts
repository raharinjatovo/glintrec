import { describe, expect, it } from 'vitest';
import {
  controlHudDockedRect, controlHudModeLabel, controlHudRect, controlHudView, parseControlHudCommand, sameControlHudState, sanitizeControlHudState,
} from '../src/shared/control-hud';

describe('control hud', () => {
  it('whitelists commands', () => {
    for (const c of ['pause-toggle', 'switch-mode', 'stop']) expect(parseControlHudCommand(c)).toBe(c);
    for (const c of ['quit', '', 'STOP', null, undefined, 1, {}, ['stop']]) expect(parseControlHudCommand(c)).toBeNull();
  });
  it('sanitizes state', () => {
    expect(sanitizeControlHudState({ phase: 'paused', mode: 'camera', canSwitch: true })).toEqual({ phase: 'paused', mode: 'camera', canSwitch: true });
    expect(sanitizeControlHudState({ phase: 'recording', mode: 'screen', canSwitch: 'yes' })?.canSwitch).toBe(false);
    for (const raw of [null, 3, [], { phase: 'idle', mode: 'screen' }, { phase: 'recording', mode: 'x' }, {}]) expect(sanitizeControlHudState(raw)).toBeNull();
  });
  it('labels the target mode and the pause state', () => {
    expect(controlHudModeLabel('screen')).toBe('Cam seule');
    expect(controlHudModeLabel('camera')).toBe('Cam + écran');
    expect(controlHudView({ phase: 'recording', mode: 'screen', canSwitch: true })).toMatchObject({ paused: false, pauseLabel: 'Pause', canSwitch: true });
    expect(controlHudView({ phase: 'paused', mode: 'camera', canSwitch: false })).toMatchObject({ paused: true, pauseLabel: 'Reprendre', modeLabel: 'Cam + écran', canSwitch: false });
  });
  it('compares states', () => {
    const a = { phase: 'recording' as const, mode: 'screen' as const, canSwitch: true };
    expect(sameControlHudState(a, { ...a })).toBe(true);
    expect(sameControlHudState(a, { ...a, phase: 'paused' })).toBe(false);
    expect(sameControlHudState(null, null)).toBe(true);
    expect(sameControlHudState(a, null)).toBe(false);
  });
  it('docks next to the annotation bar without overlapping it', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    const size = { width: 330, height: 44 };
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const bar = { x: 800, y: 12, width: 400, height: 38 };
    expect(controlHudDockedRect({ bar, area }, size, 8)).toEqual({ x: 835, y: 58, width: 330, height: 44 }); // below, centred
    const low = { x: 800, y: 1030, width: 400, height: 38 };
    const above = controlHudDockedRect({ bar: low, area }, size, 8);
    expect(above.y).toBe(978); // no room below: above
    expect(overlaps(above, low)).toBe(false);
    const edge = controlHudDockedRect({ bar: { x: 1800, y: 12, width: 100, height: 38 }, area }, size, 8);
    expect(edge.x).toBe(1590); // clamped inside the display
    const tiny = { x: 0, y: 0, width: 500, height: 100 };
    const side = controlHudDockedRect({ bar: { x: 10, y: 10, width: 300, height: 80 }, area: tiny }, size, 8);
    expect(side.x + side.width).toBeLessThanOrEqual(500); // clamped; never leaves the display
  });
  it('centres at the top of the display', () => {
    expect(controlHudRect({ x: 1920, y: 0, width: 1920, height: 1080 }, { width: 330, height: 44 }, 16)).toEqual({ x: 2715, y: 16, width: 330, height: 44 });
  });
});
