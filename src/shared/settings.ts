import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './hotkeys';
import { DEFAULT_THEME, sanitizeTheme } from './theme';
import { DEFAULT_QUALITY, QUALITY_IDS } from './quality';
import type { BackgroundMode, CaptureMode, Corner, MobileFraming, OutputFormat, Settings, Shape, ZoomLevel } from './ipc';

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: DEFAULT_THEME,
  captureMode: 'screen',
  sourceId: null,
  cameraDeviceId: null,
  micDeviceId: null,
  cameraEnabled: true,
  micEnabled: true,
  systemAudioEnabled: false,
  videoOnly: false,
  micProcessing: true,
  quality: DEFAULT_QUALITY,
  outputFormat: 'pc',
  mobile: { framing: 'follow', focusX: 0.5, cameraZoom: 0.3 },
  hotkeys: { ...DEFAULT_HOTKEYS },
  background: { mode: 'none', color: '#1e90ff', imagePath: null, blurRadius: 12 },
  overlay: { corner: 'bottom-right', sizePercent: 22, shape: 'circle', marginPercent: 2, pos: null,
    mirror: true, border: { enabled: true, color: '#ffffff', width: 3 },
  },
  effects: { cursorHighlight: false, clickRipples: false, keystrokes: false, autoZoom: 1, zoomHud: true },
};

const CAPTURE_MODES: CaptureMode[] = ['screen', 'camera'];
const OUTPUT_FORMATS: OutputFormat[] = ['pc', 'mobile'];
const MOBILE_FRAMINGS: MobileFraming[] = ['fit', 'focus', 'follow'];
const MODES: BackgroundMode[] = ['none', 'blur', 'color', 'image'];
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const SHAPES: Shape[] = ['circle', 'rounded'];

export const ZOOM_LEVELS: ZoomLevel[] = [1, 1.5, 2];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function pick<T extends string>(v: unknown, allowed: T[], def: T): T {
  return typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : def;
}
function num(v: unknown, min: number, max: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length < 2048 ? v : null;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}

/** Both coordinates must be finite numbers, else null; out-of-range values are clamped to [0,1]. */
function sanitizePos(v: unknown): { x: number; y: number } | null {
  if (!isObj(v)) return null;
  if (typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  return { x: num(v.x, 0, 1, 0), y: num(v.y, 0, 1, 0) };
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = isObj(raw) ? raw : {};
  const bg = isObj(r.background) ? r.background : {};
  const ov = isObj(r.overlay) ? r.overlay : {};
  const bd = isObj(ov.border) ? ov.border : {};
  const mb = isObj(r.mobile) ? r.mobile : {};
  const fx = isObj(r.effects) ? r.effects : {};
  return {
    version: 1,
    theme: sanitizeTheme(r.theme),
    captureMode: pick(r.captureMode, CAPTURE_MODES, d.captureMode),
    sourceId: str(r.sourceId),
    cameraDeviceId: str(r.cameraDeviceId),
    micDeviceId: str(r.micDeviceId),
    cameraEnabled: bool(r.cameraEnabled, d.cameraEnabled),
    micEnabled: bool(r.micEnabled, d.micEnabled),
    systemAudioEnabled: bool(r.systemAudioEnabled, d.systemAudioEnabled),
    videoOnly: bool(r.videoOnly, d.videoOnly),
    micProcessing: bool(r.micProcessing, d.micProcessing),
    quality: pick(r.quality, QUALITY_IDS, d.quality),
    outputFormat: pick(r.outputFormat, OUTPUT_FORMATS, d.outputFormat),
    mobile: {
      framing: pick(mb.framing, MOBILE_FRAMINGS, d.mobile.framing),
      focusX: num(mb.focusX, 0, 1, d.mobile.focusX),
      cameraZoom: num(mb.cameraZoom, 0, 1, d.mobile.cameraZoom),
    },
    hotkeys: sanitizeHotkeys(r.hotkeys),
    background: {
      mode: pick(bg.mode, MODES, d.background.mode),
      color:
        typeof bg.color === 'string' && HEX_COLOR.test(bg.color) ? bg.color : d.background.color,
      imagePath: str(bg.imagePath),
      blurRadius: num(bg.blurRadius, 2, 40, d.background.blurRadius),
    },
    overlay: {
      corner: pick(ov.corner, CORNERS, d.overlay.corner),
      sizePercent: num(ov.sizePercent, 10, 40, d.overlay.sizePercent),
      shape: pick(ov.shape, SHAPES, d.overlay.shape),
      marginPercent: d.overlay.marginPercent,
      pos: sanitizePos(ov.pos),
      mirror: bool(ov.mirror, d.overlay.mirror),
      border: {
        enabled: bool(bd.enabled, d.overlay.border.enabled),
        color: typeof bd.color === 'string' && HEX_COLOR.test(bd.color) ? bd.color : d.overlay.border.color,
        width: Math.round(num(bd.width, 1, 16, d.overlay.border.width)),
      },
    },
    effects: {
      cursorHighlight: bool(fx.cursorHighlight, d.effects.cursorHighlight),
      clickRipples: bool(fx.clickRipples, d.effects.clickRipples),
      keystrokes: bool(fx.keystrokes, d.effects.keystrokes),
      autoZoom: ZOOM_LEVELS.find((z) => z === fx.autoZoom) ?? d.effects.autoZoom,
      zoomHud: bool(fx.zoomHud, d.effects.zoomHud),
    },
  };
}
