import { findHotkeyConflict, validateAccelerator } from '../shared/hotkeys';
import type { CaptureMode, CaptureSource, HotkeyAction, MobileFraming, OutputFormat, QualityId, Settings } from '../shared/ipc';
import { QUALITY_PRESETS } from '../shared/quality';
import {
  clientToCanvas, grabOffset, hitTestOverlay, overlayRectFor, pointerToPos, type Point,
} from '../shared/overlay-layout';
import type { RecState } from '../shared/recorder-machine';
import { captureModeLabel, nextCaptureMode } from '../shared/quick-toggles';

export interface Els {
  preview: HTMLCanvasElement;
  captureMode: HTMLSelectElement;
  outputFormat: HTMLSelectElement;
  quickMode: HTMLButtonElement;
  mobileSection: HTMLElement;
  mobileFramingRow: HTMLElement;
  mobileFraming: HTMLSelectElement;
  mobileFocusRow: HTMLElement;
  mobileFocus: HTMLInputElement;
  mobileZoomRow: HTMLElement;
  mobileZoom: HTMLInputElement;
  sourceSection: HTMLElement;
  systemAudioRow: HTMLElement;
  overlaySection: HTMLElement;
  dragHint: HTMLElement;
  sourceList: HTMLElement;
  refreshSources: HTMLButtonElement;
  openMobileBrowser: HTMLButtonElement;
  cameraSelect: HTMLSelectElement;
  micSelect: HTMLSelectElement;
  cameraToggle: HTMLInputElement;
  mirrorToggle: HTMLInputElement;
  micToggle: HTMLInputElement;
  micProcessingToggle: HTMLInputElement;
  systemAudioToggle: HTMLInputElement;
  videoOnlyToggle: HTMLInputElement;
  cornerSelect: HTMLSelectElement;
  sizeRange: HTMLInputElement;
  shapeSelect: HTMLSelectElement;
  borderToggle: HTMLInputElement;
  borderColor: HTMLInputElement;
  borderWidth: HTMLInputElement;
  qualitySelect: HTMLSelectElement;
  hotkeyInputs: Record<HotkeyAction, HTMLInputElement>;
  hotkeyNote: HTMLElement;
  effectsSection: HTMLElement;
  fxCursor: HTMLInputElement;
  fxRipples: HTMLInputElement;
  fxZoom: HTMLSelectElement;
  fxKeys: HTMLInputElement;
  fxZoomHud: HTMLInputElement;
  screenshot: HTMLButtonElement;
  exportRow: HTMLElement;
  exportMp4: HTMLButtonElement;
  exportGif: HTMLButtonElement;
  bgMode: HTMLSelectElement;
  bgColor: HTMLInputElement;
  bgImageBtn: HTMLButtonElement;
  blurRange: HTMLInputElement;
  start: HTMLButtonElement;
  pause: HTMLButtonElement;
  stop: HTMLButtonElement;
  timer: HTMLElement;
  countdown: HTMLElement;
  status: HTMLElement;
  ffmpegNote: HTMLElement;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

export function getEls(): Els {
  return {
    preview: el('preview'),
    captureMode: el('capture-mode'),
    outputFormat: el('output-format'),
    quickMode: el('quick-mode'),
    mobileSection: el('mobile-section'),
    mobileFramingRow: el('mobile-framing-row'),
    mobileFraming: el('mobile-framing'),
    mobileFocusRow: el('mobile-focus-row'),
    mobileFocus: el('mobile-focus'),
    mobileZoomRow: el('mobile-zoom-row'),
    mobileZoom: el('mobile-zoom'),
    sourceSection: el('source-section'),
    systemAudioRow: el('system-audio-row'),
    overlaySection: el('overlay-section'),
    dragHint: el('drag-hint'),
    sourceList: el('source-list'),
    refreshSources: el('refresh-sources'),
    openMobileBrowser: el('open-mobile-browser'),
    cameraSelect: el('camera-select'),
    micSelect: el('mic-select'),
    cameraToggle: el('camera-toggle'),
    mirrorToggle: el('mirror-toggle'),
    micToggle: el('mic-toggle'),
    micProcessingToggle: el('mic-processing-toggle'),
    systemAudioToggle: el('system-audio-toggle'),
    videoOnlyToggle: el('video-only-toggle'),
    cornerSelect: el('corner-select'),
    sizeRange: el('size-range'),
    shapeSelect: el('shape-select'),
    borderToggle: el('border-toggle'),
    borderColor: el('border-color'),
    borderWidth: el('border-width'),
    qualitySelect: el('quality-select'),
    hotkeyInputs: {
      toggle: el('hotkey-toggle'),
      pause: el('hotkey-pause'),
      screenshot: el('hotkey-screenshot'),
      annotate: el('hotkey-annotate'),
      zoomIn: el('hotkey-zoom-in'),
      zoomOut: el('hotkey-zoom-out'),
      zoomReset: el('hotkey-zoom-reset'),
      toggleCamera: el('hotkey-toggle-camera'),
    },
    hotkeyNote: el('hotkey-note'),
    effectsSection: el('effects-section'),
    fxCursor: el('fx-cursor'),
    fxRipples: el('fx-ripples'),
    fxZoom: el('fx-zoom'),
    fxKeys: el('fx-keys'),
    fxZoomHud: el('fx-zoom-hud'),
    screenshot: el('screenshot'),
    exportRow: el('export-row'),
    exportMp4: el('export-mp4'),
    exportGif: el('export-gif'),
    bgMode: el('bg-mode'),
    bgColor: el('bg-color'),
    bgImageBtn: el('bg-image-btn'),
    blurRange: el('blur-range'),
    start: el('start'),
    pause: el('pause'),
    stop: el('stop'),
    timer: el('timer'),
    countdown: el('countdown'),
    status: el('status'),
    ffmpegNote: el('ffmpeg-note'),
  };
}

/** Fill controls from settings and mutate `settings` on user input, calling onChange(kind). */
export function bindSettings(
  els: Els, settings: Settings,
  onChange: (kind: 'camera' | 'mic' | 'system-audio' | 'image' | 'mode' | 'quality' | 'hotkeys' | 'other') => void,
  onInvalid: (message: string) => void = () => undefined,
  /** Quick camera/screen button while not idle: return true when the click was handled as a live switch. */
  onLiveSwitch: () => boolean = () => false,
): void {
  els.captureMode.value = settings.captureMode;
  applyCaptureMode(els, settings.captureMode);
  els.outputFormat.value = settings.outputFormat;
  els.mobileFraming.value = settings.mobile.framing;
  els.mobileFocus.value = String(Math.round(settings.mobile.focusX * 100));
  els.mobileZoom.value = String(Math.round(settings.mobile.cameraZoom * 100));
  applyOutputFormat(els, settings);
  els.cameraToggle.checked = settings.cameraEnabled;
  els.micToggle.checked = settings.micEnabled;
  els.micProcessingToggle.checked = settings.micProcessing;
  els.mirrorToggle.checked = settings.overlay.mirror;
  els.borderToggle.checked = settings.overlay.border.enabled;
  els.borderColor.value = settings.overlay.border.color;
  els.borderWidth.value = String(settings.overlay.border.width);
  els.qualitySelect.replaceChildren(...QUALITY_PRESETS.map((p) => new Option(p.label, p.id)));
  els.qualitySelect.value = settings.quality;
  for (const a of Object.keys(els.hotkeyInputs) as HotkeyAction[]) els.hotkeyInputs[a].value = settings.hotkeys[a];
  els.fxCursor.checked = settings.effects.cursorHighlight;
  els.fxRipples.checked = settings.effects.clickRipples;
  els.fxKeys.checked = settings.effects.keystrokes;
  els.fxZoom.value = String(settings.effects.autoZoom);
  els.fxZoomHud.checked = settings.effects.zoomHud;
  els.systemAudioToggle.checked = settings.systemAudioEnabled;
  els.videoOnlyToggle.checked = settings.videoOnly;
  els.cornerSelect.value = settings.overlay.corner;
  els.sizeRange.value = String(settings.overlay.sizePercent);
  els.shapeSelect.value = settings.overlay.shape;
  els.bgMode.value = settings.background.mode;
  els.bgColor.value = settings.background.color;
  els.blurRange.value = String(settings.background.blurRadius);

  els.captureMode.onchange = () => {
    settings.captureMode = els.captureMode.value as CaptureMode;
    applyCaptureMode(els, settings.captureMode);
    applyOutputFormat(els, settings);
    syncQuickToggles(els, settings);
    onChange('mode');
  };
  els.outputFormat.onchange = () => {
    settings.outputFormat = els.outputFormat.value as OutputFormat;
    applyOutputFormat(els, settings);
    syncQuickToggles(els, settings);
    // Camera-only asks for a higher resolution in portrait: reopen the camera (selector is locked while recording).
    onChange(settings.captureMode === 'camera' ? 'camera' : 'other');
  };
  // Quick buttons drive the selects so they share the exact same change path.
  els.quickMode.onclick = () => {
    if (onLiveSwitch()) return;
    els.captureMode.value = nextCaptureMode(settings.captureMode);
    els.captureMode.onchange?.(new Event('change'));
  };
  syncQuickToggles(els, settings);
  els.mobileFraming.onchange = () => {
    settings.mobile.framing = els.mobileFraming.value as MobileFraming;
    applyOutputFormat(els, settings);
    onChange('other');
  };
  els.mobileZoom.oninput = () => { settings.mobile.cameraZoom = Number(els.mobileZoom.value) / 100; onChange('other'); };
  els.mobileFocus.oninput = () => { settings.mobile.focusX = Number(els.mobileFocus.value) / 100; onChange('other'); };
  els.cameraToggle.onchange = () => { settings.cameraEnabled = els.cameraToggle.checked; onChange('camera'); };
  els.micToggle.onchange = () => { settings.micEnabled = els.micToggle.checked; onChange('mic'); };
  els.micProcessingToggle.onchange = () => { settings.micProcessing = els.micProcessingToggle.checked; onChange('mic'); };
  els.mirrorToggle.onchange = () => { settings.overlay.mirror = els.mirrorToggle.checked; onChange('other'); };
  els.borderToggle.onchange = () => { settings.overlay.border.enabled = els.borderToggle.checked; onChange('other'); };
  els.borderColor.oninput = () => { settings.overlay.border.color = els.borderColor.value; onChange('other'); };
  els.borderWidth.oninput = () => { settings.overlay.border.width = Number(els.borderWidth.value); onChange('other'); };
  els.qualitySelect.onchange = () => { settings.quality = els.qualitySelect.value as QualityId; onChange('quality'); };
  for (const action of Object.keys(els.hotkeyInputs) as HotkeyAction[]) {
    const input = els.hotkeyInputs[action];
    input.onchange = () => {
      const text = input.value.trim();
      const accel = text === '' ? '' : validateAccelerator(text);
      const clash = accel === null ? null : findHotkeyConflict(settings.hotkeys, action, accel);
      if (accel === null || clash) {
        input.value = settings.hotkeys[action];
        onInvalid(accel === null ? `"${text}" is not a valid shortcut (example: CommandOrControl+Shift+R)` : `That shortcut is already used by "${clash}"`);
        return;
      }
      settings.hotkeys[action] = accel;
      input.value = accel;
      onChange('hotkeys');
    };
  }
  els.fxCursor.onchange = () => { settings.effects.cursorHighlight = els.fxCursor.checked; onChange('other'); };
  els.fxRipples.onchange = () => { settings.effects.clickRipples = els.fxRipples.checked; onChange('other'); };
  els.fxKeys.onchange = () => { settings.effects.keystrokes = els.fxKeys.checked; onChange('other'); };
  els.fxZoomHud.onchange = () => { settings.effects.zoomHud = els.fxZoomHud.checked; onChange('other'); };
  els.fxZoom.onchange = () => { settings.effects.autoZoom = Number(els.fxZoom.value) as Settings['effects']['autoZoom']; onChange('other'); };
  els.videoOnlyToggle.onchange = () => { settings.videoOnly = els.videoOnlyToggle.checked; onChange('other'); };
  els.systemAudioToggle.onchange = () => { settings.systemAudioEnabled = els.systemAudioToggle.checked; onChange('system-audio'); };
  els.cameraSelect.onchange = () => { settings.cameraDeviceId = els.cameraSelect.value || null; onChange('camera'); };
  els.micSelect.onchange = () => { settings.micDeviceId = els.micSelect.value || null; onChange('mic'); };
  els.cornerSelect.onchange = () => { settings.overlay.corner = els.cornerSelect.value as Settings['overlay']['corner']; settings.overlay.pos = null; onChange('other'); };
  els.sizeRange.oninput = () => { settings.overlay.sizePercent = Number(els.sizeRange.value); onChange('other'); };
  els.shapeSelect.onchange = () => { settings.overlay.shape = els.shapeSelect.value as Settings['overlay']['shape']; onChange('other'); };
  els.bgMode.onchange = () => { settings.background.mode = els.bgMode.value as Settings['background']['mode']; onChange('image'); };
  els.bgColor.oninput = () => { settings.background.color = els.bgColor.value; onChange('other'); };
  els.blurRange.oninput = () => { settings.background.blurRadius = Number(els.blurRange.value); onChange('other'); };
}

/** Keep the quick buttons' label and aria-pressed in step with settings. */
export function syncQuickToggles(els: Els, settings: Settings): void {
  els.quickMode.textContent = captureModeLabel(settings.captureMode);
  els.quickMode.setAttribute('aria-pressed', String(settings.captureMode === 'camera'));
  const key = settings.hotkeys.toggleCamera;
  els.quickMode.title = `Switch between camera only and screen + camera, also while recording${key ? ` (${key})` : ''}`;
}

/** Show only the sections relevant to the mode; camera mode forces the camera on. */
export function applyCaptureMode(els: Els, mode: CaptureMode): void {
  const cam = mode === 'camera';
  els.sourceSection.hidden = cam;
  els.overlaySection.hidden = cam;
  els.effectsSection.hidden = cam;
  els.dragHint.hidden = cam;
  if (cam) els.cameraToggle.checked = true;
  els.cameraToggle.disabled = cam;
}

/** Mobile options only show for the portrait format. For camera-only 'follow' behaves like 'focus' (no cursor); the slider shows unless 'fit'. */
export function applyOutputFormat(els: Els, settings: Settings): void {
  els.mobileSection.hidden = settings.outputFormat !== 'mobile';
  const camOnly = settings.captureMode === 'camera';
  const follow = els.mobileFraming.querySelector('option[value="follow"]');
  if (follow) follow.textContent = camOnly ? 'Crop at focus point (same as above)' : 'Crop follows cursor';
  els.mobileZoomRow.hidden = !(camOnly && settings.mobile.framing !== 'fit');
  els.mobileFocusRow.hidden = camOnly ? settings.mobile.framing === 'fit' : settings.mobile.framing !== 'focus';
}

export function fillDeviceSelect(sel: HTMLSelectElement, devices: MediaDeviceInfo[], selected: string | null): void {
  sel.replaceChildren();
  devices.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Device ${i + 1}`;
    sel.appendChild(o);
  });
  if (selected && devices.some((d) => d.deviceId === selected)) sel.value = selected;
}

export function renderSources(
  list: CaptureSource[], els: Els, selectedId: string | null, onSelect: (id: string) => void,
): void {
  els.sourceList.replaceChildren();
  for (const s of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'source' + (s.id === selectedId ? ' selected' : '');
    if (s.thumbnailDataUrl) {
      const img = document.createElement('img');
      img.src = s.thumbnailDataUrl;
      img.alt = '';
      b.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = (s.kind === 'screen' ? '[Screen] ' : '') + s.name;
    b.appendChild(label);
    b.onclick = () => {
      els.sourceList.querySelectorAll('.source').forEach((n) => n.classList.remove('selected'));
      b.classList.add('selected');
      onSelect(s.id);
    };
    els.sourceList.appendChild(b);
  }
}

export function showCountdown(els: Els, n: number | null): void {
  els.countdown.hidden = n === null;
  els.countdown.textContent = n === null ? '' : String(n);
}

export function setTimer(els: Els, text: string): void {
  els.timer.textContent = text;
}

export function setStatus(els: Els, text: string): void {
  els.status.textContent = text;
}

export function setButtons(els: Els, state: RecState): void {
  const p = state.phase;
  if (typeof document !== 'undefined') document.body.dataset.phase = p; // styling hook (REC indicator, Record button)
  els.start.disabled = p !== 'idle';
  els.pause.disabled = !(p === 'recording' || p === 'paused');
  els.pause.textContent = p === 'paused' ? 'Resume' : 'Pause';
  els.stop.disabled = p === 'idle' || p === 'stopping';
  els.stop.textContent = p === 'countdown' ? 'Cancel' : 'Stop';
  const lock = p !== 'idle';
  for (const c of [els.captureMode, els.outputFormat, els.cameraSelect, els.micSelect, els.systemAudioToggle, els.videoOnlyToggle, els.refreshSources, els.openMobileBrowser,
    els.qualitySelect, els.micProcessingToggle, els.fxCursor, els.fxRipples, els.fxZoom, els.fxKeys]) {
    c.disabled = lock;
  }
  // The camera/screen switch stays usable while recording or paused (live switch); not during countdown/stopping.
  els.quickMode.disabled = p === 'countdown' || p === 'stopping';
  els.sourceList.classList.toggle('locked', lock);
}

export interface OverlayDragHooks {
  /** Called on every move (redraw/state push); the compositor repaints every frame anyway. */
  onMove(): void;
  /** Called once when a drag ends (pointerup/cancel): persist settings here. */
  onCommit(): void;
}

/** Drag the camera overlay with the mouse on the preview canvas (pointer events + pointer capture). */
export function bindOverlayDrag(canvas: HTMLCanvasElement, settings: Settings, hooks: OverlayDragHooks): void {
  let pointerId: number | null = null;
  let grab: Point = { x: 0, y: 0 };
  canvas.style.touchAction = 'none';

  const canvasSize = () => ({ width: canvas.width, height: canvas.height });
  const rectNow = () => overlayRectFor(canvasSize(), settings.overlay);
  const toCanvas = (e: PointerEvent): Point => {
    const b = canvas.getBoundingClientRect();
    return clientToCanvas(e.clientX, e.clientY, { x: b.left, y: b.top, width: b.width, height: b.height }, canvasSize());
  };
  const overOverlay = (e: PointerEvent) =>
    settings.captureMode === 'screen' && settings.cameraEnabled && hitTestOverlay(toCanvas(e), rectNow(), settings.overlay.shape);
  const end = (e: PointerEvent) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    pointerId = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    canvas.style.cursor = overOverlay(e) ? 'grab' : 'default';
    hooks.onCommit();
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (pointerId !== null || e.button !== 0 || !overOverlay(e)) return;
    pointerId = e.pointerId;
    grab = grabOffset(toCanvas(e), rectNow());
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointerId === null) { canvas.style.cursor = overOverlay(e) ? 'grab' : 'default'; return; }
    if (e.pointerId !== pointerId) return;
    const r = rectNow();
    settings.overlay.pos = pointerToPos(toCanvas(e), grab, canvasSize(), r);
    hooks.onMove();
  });
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
}

/** Shortcut registration problems reported by the main process (e.g. taken by another app). */
export function renderHotkeyStatus(els: Els, failed: { action: HotkeyAction; accelerator: string; reason: string }[]): void {
  els.hotkeyNote.textContent = failed.length === 0
    ? 'Example: CommandOrControl+Shift+R. Leave empty to disable.'
    : 'Not active: ' + failed.map((f) => `${f.accelerator} (${f.reason})`).join('; ');
}
