import type { Rect } from './overlay-layout';
import type { CaptureMode } from './ipc';

/** Toolbar page -> main (send): a button was clicked. */
export const CONTROL_HUD_COMMAND_CHANNEL = 'controlhud:command';
/** Main -> toolbar page: the state to display. */
export const CONTROL_HUD_VIEW_EVENT = 'controlhud:view';
/** Main -> main renderer: a toolbar command to run through the same code path as the buttons. */
export const CONTROL_HUD_RELAY_EVENT = 'controlhud:relay';

/** Annotation overlay page -> main (send): a click on the controls rendered inside the overlay (same whitelist). */
export const ANNOTATION_CONTROL_CHANNEL = 'annotation:control';
/** Main -> annotation overlay page: the state to display in its in-overlay controls (ControlHudView, or null = none). */
export const ANNOTATION_CONTROL_VIEW_EVENT = 'annotation:controlview';

export const CONTROL_HUD_COMMANDS = ['pause-toggle', 'switch-mode', 'stop'] as const;
export type ControlHudCommand = (typeof CONTROL_HUD_COMMANDS)[number];

export type ControlHudPhase = 'recording' | 'paused';

export interface ControlHudState {
  phase: ControlHudPhase;
  mode: CaptureMode;
  canSwitch: boolean;
}

/** What the toolbar page displays: fixed French vocabulary derived in main. */
export interface ControlHudView {
  paused: boolean;
  pauseLabel: string;
  modeLabel: string;
  stopLabel: string;
  canSwitch: boolean;
}

/** Validates a renderer state message; null when it is not usable (also null = hide the toolbar upstream). */
export function sanitizeControlHudState(raw: unknown): ControlHudState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.phase !== 'recording' && r.phase !== 'paused') return null;
  if (r.mode !== 'screen' && r.mode !== 'camera') return null;
  return { phase: r.phase, mode: r.mode, canSwitch: r.canSwitch === true };
}

/** Whitelist for the commands coming from the toolbar page. */
export function parseControlHudCommand(raw: unknown): ControlHudCommand | null {
  return typeof raw === 'string' && (CONTROL_HUD_COMMANDS as readonly string[]).includes(raw) ? (raw as ControlHudCommand) : null;
}

export function controlHudModeLabel(mode: CaptureMode): string {
  // The button names the mode it switches TO.
  return mode === 'screen' ? 'Cam seule' : 'Cam + écran';
}

export function controlHudView(s: ControlHudState): ControlHudView {
  const paused = s.phase === 'paused';
  return {
    paused,
    pauseLabel: paused ? 'Reprendre' : 'Pause',
    modeLabel: controlHudModeLabel(s.mode),
    stopLabel: 'Arrêter',
    canSwitch: s.canSwitch,
  };
}

export function sameControlHudState(a: ControlHudState | null, b: ControlHudState | null): boolean {
  if (!a || !b) return a === b;
  return a.phase === b.phase && a.mode === b.mode && a.canSwitch === b.canSwitch;
}

/** The annotation bar (DIP, screen coordinates) and the display it is on: the toolbar docks next to it. */
export interface ControlHudAnchor { bar: Rect; area: Rect }

/**
 * Which rectangle the toolbar docks to: the annotation bar wins (it is the thing being used), else the mobile window
 * (mobile output), else null = top-centre of the recorded display. `mobileEnabled` is false outside mobile output.
 */
export function pickControlHudAnchor(bar: ControlHudAnchor | null, mobile: ControlHudAnchor | null, mobileEnabled: boolean): ControlHudAnchor | null {
  if (!mobileEnabled) return null;
  return bar ?? mobile ?? null;
}

const clampInto = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Window rectangle (DIPs) docked to the annotation bar without overlapping it, inside the bar's display: below the bar
 * (centred on it), else above it, else beside it. The result always lies inside `anchor.area`.
 */
export function controlHudDockedRect(anchor: ControlHudAnchor, size: { width: number; height: number }, gap: number): Rect {
  const { bar, area } = anchor;
  const maxX = area.x + area.width - size.width;
  const maxY = area.y + area.height - size.height;
  const centredX = bar.x + (bar.width - size.width) / 2;
  let x = centredX;
  let y = bar.y + bar.height + gap; // below
  if (y > maxY) {
    y = bar.y - gap - size.height; // above
    if (y < area.y) { // beside: right of the bar, else left
      x = bar.x + bar.width + gap > maxX ? bar.x - gap - size.width : bar.x + bar.width + gap;
      y = bar.y + (bar.height - size.height) / 2;
    }
  }
  return { x: Math.round(clampInto(x, area.x, maxX)), y: Math.round(clampInto(y, area.y, maxY)), width: size.width, height: size.height };
}

/** Window rectangle (DIPs): horizontally centred at the top of the display (zoom HUD is top-right, camera bubble bottom-right). */
export function controlHudRect(area: Rect, size: { width: number; height: number }, margin: number): Rect {
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: area.y + margin,
    width: size.width,
    height: size.height,
  };
}
