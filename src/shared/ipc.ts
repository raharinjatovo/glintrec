export const IPC = {
  listSources: 'sources:list',
  selectCaptureSource: 'capture:select',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  pickImage: 'image:pick',
  loadImage: 'image:load',
  checkFfmpeg: 'ffmpeg:check',
  recBegin: 'recording:begin',
  recChunk: 'recording:chunk',
  recAbort: 'recording:abort',
  recFinish: 'recording:finish',
  overlayShow: 'overlay:show',
  overlayUpdate: 'overlay:update',
  overlayHide: 'overlay:hide',
  saveScreenshot: 'screenshot:save',
  exportRecording: 'recording:export',
  getHotkeyStatus: 'hotkeys:status',
  libraryList: 'library:list',
  libraryOpen: 'library:open',
  libraryReveal: 'library:reveal',
  libraryDelete: 'library:delete',
  libraryExport: 'library:export',
  libraryTrim: 'library:trim',
  inputStart: 'input:start',
  inputStop: 'input:stop',
  zoomHudUpdate: 'zoomhud:update',
  controlHudState: 'controlhud:state',
  captureFrameUpdate: 'captureframe:update',
  openMobileBrowser: 'mobilebrowser:open',
} as const;
/** Main -> renderer events (not invoke handlers). */
export const IPC_EVENTS = {
  overlayMoved: 'overlay:moved',
  hotkeyTriggered: 'hotkey:triggered',
  hotkeyStatus: 'hotkey:status',
  inputEvent: 'input:event',
} as const;

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnailDataUrl: string;
  displayId?: string;
}
/** 'screen' = screen capture with camera overlay; 'camera' = camera only, full frame. */
export type CaptureMode = 'screen' | 'camera';
/** Output shape: 'pc' = source-shaped landscape, 'mobile' = fixed 9:16 portrait. */
export type OutputFormat = 'pc' | 'mobile';
/** Mobile screen framing: fit the whole screen with blurred bars, crop at a fixed point, or crop following the cursor. */
export type MobileFraming = 'fit' | 'focus' | 'follow';
export interface MobileSettings {
  framing: MobileFraming;
  /** Horizontal centre of the crop as a fraction of the frame width (focus framing). */
  focusX: number;
  /** Camera-only zoom: 0 = whole frame fits the width, 1 = tight full-height crop. */
  cameraZoom: number;
}
export type BackgroundMode = 'none' | 'blur' | 'color' | 'image';
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type Shape = 'circle' | 'rounded';
export type QualityId = '720p30' | '1080p30' | '1080p60';
export type HotkeyAction = 'toggle' | 'pause' | 'screenshot' | 'annotate' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'toggleCamera';
/** Electron accelerator per action; '' = disabled. */
export type HotkeySettings = Record<HotkeyAction, string>;
/** Optional ring around the camera bubble; width in canvas pixels, drawn inside the bubble's rect. */
export interface OverlayBorder { enabled: boolean; color: string; width: number }
/** pos: normalized [0,1] fractions of the free space (see overlayRectFor); null = use `corner`. */
export interface OverlaySettings {
  corner: Corner;
  sizePercent: number;
  shape: Shape;
  marginPercent: number;
  pos: { x: number; y: number } | null;
  /** Selfie view (horizontally flipped). */
  mirror: boolean;
  border: OverlayBorder;
}
/** Auto-zoom strength on click: 1 = off. */
export type ZoomLevel = 1 | 1.5 | 2;
/** Recording effects drawn on the compositor canvas (screen sources only). All off by default. */
export interface EffectSettings {
  cursorHighlight: boolean;
  clickRipples: boolean;
  /** Shows typed keys in the recording (passwords included): never on by default. */
  keystrokes: boolean;
  autoZoom: ZoomLevel;
  /** Small always-on-top indicator of the current zoom over the real desktop (hidden from the recording). */
  zoomHud: boolean;
}
/** Colour theme preference: 'system' follows the OS. */
export type ThemePref = 'system' | 'dark' | 'light';
export interface Settings {
  version: 1;
  theme: ThemePref;
  captureMode: CaptureMode;
  sourceId: string | null;
  cameraDeviceId: string | null;
  micDeviceId: string | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  systemAudioEnabled: boolean;
  /** Record no audio track at all (mic and system audio ignored). */
  videoOnly: boolean;
  /** Mic noise suppression + echo cancellation + auto gain (getUserMedia constraints). */
  micProcessing: boolean;
  quality: QualityId;
  outputFormat: OutputFormat;
  mobile: MobileSettings;
  hotkeys: HotkeySettings;
  background: { mode: BackgroundMode; color: string; imagePath: string | null; blurRadius: number };
  overlay: OverlaySettings;
  effects: EffectSettings;
}
/** A display as the renderer needs it to map cursor positions: bounds in DIPs (screen coordinates). */
export interface DisplayInfo {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}
/** What the main process should watch while a recording runs; everything is off unless asked for. */
export interface InputRequest { cursor: boolean; clicks: boolean; keys: boolean }
export interface InputStartResult {
  /** The native mouse/keyboard hook loaded and started (needed for clicks and keys). */
  hookAvailable: boolean;
  /** Display being captured; null when unknown (window source), then cursor effects are skipped. */
  display: DisplayInfo | null;
  /** True when `display` is only a guess (source display unknown): usable for manual zoom, not for cursor/click drawing. */
  approximate?: boolean;
  /** Plain-language status for the UI; empty when everything requested works. */
  message: string;
}
export type MouseButtonName = 'left' | 'right' | 'middle';
/** Main -> renderer while recording. Positions are DIPs; key events carry only a display label. */
export type InputEvent =
  | { t: 'cursor'; x: number; y: number }
  | { t: 'click'; x: number; y: number; button: MouseButtonName }
  | { t: 'key'; text: string; combo: boolean };
export type PickImageResult = { path: string } | null;
export interface LoadImageResult { mime: string; bytes: ArrayBuffer }
export interface FfmpegStatus { available: boolean; version: string | null }
export interface HotkeyFailure { action: HotkeyAction; accelerator: string; reason: string }
export interface HotkeyStatus { registered: HotkeyAction[]; failed: HotkeyFailure[] }
export type ExportFormat = 'mp4' | 'gif';
/** Converts the most recently saved recording (the main process remembers its path). */
export interface ExportRequest { format: ExportFormat }
export type ExportResult =
  | { status: 'saved'; path: string; format: ExportFormat }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };
/** A saved recording as the renderer sees it: referenced by `id` only, the file path never leaves the main process. */
export interface LibraryItem {
  id: string;
  name: string;
  size: number;
  durationSec: number | null;
  /** Epoch ms. */
  createdAt: number;
  /** The file no longer exists on disk. */
  missing: boolean;
}
export type LibraryActionResult =
  | { status: 'ok' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };
/** Trim a library entry to [startSec, endSec]; `durationSec` is only a clamp hint from the preview element. */
export interface TrimRequest { id: string; startSec: number; endSec: number; durationSec?: number }
export type TrimResult =
  | { status: 'saved'; path: string }
  | { status: 'error'; message: string };
export interface ScreenshotResult { path: string }
export interface BeginRecordingResult { sessionId: string }
export interface FinishRequest { sessionId: string; suggestedName: string; wantMp4: boolean }
export type FinishResult =
  | { status: 'saved'; path: string; format: 'mp4' | 'webm'; note?: string }
  /** Session and temp file are still alive: call finish again to retry, or abort to discard. */
  | { status: 'cancelled' }
  /** `retryable`: the save failed but the session and temp file are still alive. */
  | { status: 'error'; message: string; retryable?: boolean };
/** Floating always-on-top camera bubble shown while recording. */
export interface FloatingOverlayConfig {
  cameraDeviceId: string | null;
  shape: Shape;
  sizePercent: number;
  pos: { x: number; y: number } | null;
  corner: Corner;
  mirror: boolean;
  border: OverlayBorder;
  /** Same background replacement as the recording, so the bubble matches what is recorded. */
  background: { mode: BackgroundMode; color: string; imagePath: string | null; blurRadius: number };
}
/** Result of opening the built-in mobile browser window: its capture source id (null if it could not be created). */
export interface OpenMobileBrowserResult { sourceId: string | null }
export interface RecorderApi {
  listSources(): Promise<CaptureSource[]>;
  selectCaptureSource(sourceId: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  pickImage(): Promise<PickImageResult>;
  loadImage(path: string): Promise<LoadImageResult>;
  checkFfmpeg(): Promise<FfmpegStatus>;
  beginRecording(): Promise<BeginRecordingResult>;
  writeChunk(sessionId: string, chunk: ArrayBuffer): Promise<void>;
  abortRecording(sessionId: string): Promise<void>;
  finishRecording(req: FinishRequest): Promise<FinishResult>;
  overlayShow(cfg: FloatingOverlayConfig): Promise<void>;
  overlayUpdate(cfg: FloatingOverlayConfig): Promise<void>;
  overlayHide(): Promise<void>;
  /** PNG bytes of the composited frame; saved next to the recordings. */
  saveScreenshot(png: ArrayBuffer): Promise<ScreenshotResult>;
  exportRecording(req: ExportRequest): Promise<ExportResult>;
  getHotkeyStatus(): Promise<HotkeyStatus>;
  listLibrary(): Promise<LibraryItem[]>;
  openLibraryItem(id: string): Promise<LibraryActionResult>;
  revealLibraryItem(id: string): Promise<LibraryActionResult>;
  /** Confirms in the main process, then moves the file to the trash. */
  deleteLibraryItem(id: string): Promise<LibraryActionResult>;
  exportLibraryItem(id: string, format: ExportFormat): Promise<ExportResult>;
  trimLibraryItem(req: TrimRequest): Promise<TrimResult>;
  onHotkey(cb: (action: HotkeyAction) => void): () => void;
  onHotkeyStatus(cb: (status: HotkeyStatus) => void): () => void;
  /** Starts the cursor/click/key feed (recording only); resolves with what is actually available. */
  inputStart(req: InputRequest): Promise<InputStartResult>;
  inputStop(): Promise<void>;
  /** Current zoom for the indicator window (validated again in main). */
  zoomHudUpdate(u: { factor: number; mode: 'none' | 'manual' | 'auto'; flash?: boolean }): Promise<void>;
  /** Recording state for the floating control toolbar; null = not recording (hide it). Validated again in main. */
  controlHudState(s: { phase: 'recording' | 'paused'; mode: CaptureMode; canSwitch: boolean } | null): Promise<void>;
  /** A button of the floating toolbar was clicked (pause-toggle / switch-mode / stop). */
  onControlCommand(cb: (cmd: string) => void): () => void;
  /** Part of the screen the video currently shows (0..1 fractions); null = whole screen, hide the outline. */
  captureFrameUpdate(r: { x: number; y: number; w: number; h: number } | null): Promise<void>;
  /** Opens (or focuses) the phone-shaped browser window to record in mobile format. */
  openMobileBrowser(): Promise<OpenMobileBrowserResult>;
  onInput(cb: (e: InputEvent) => void): () => void;
  /** Fired when the user drags the floating bubble; returns an unsubscribe function. */
  onOverlayMoved(cb: (pos: { x: number; y: number }) => void): () => void;
  /** Pen strokes / clear from the draw overlay (validated again by the renderer before use). */
  onAnnotation(cb: (ev: unknown) => void): () => void;
}
