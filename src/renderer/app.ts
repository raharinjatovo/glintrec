import { createGenerationGuard } from '../shared/async-guards';
import type { ExportFormat, FfmpegStatus, FinishResult, HotkeyAction, Settings } from '../shared/ipc';
import { qualityPreset } from '../shared/quality';
import { captureModeLabel, liveSwitchDecision } from '../shared/quick-toggles';
import { parseControlHudCommand, sameControlHudState, type ControlHudState } from '../shared/control-hud';
import {
  createElapsedClock, formatElapsed, initialState, reduce, type RecEvent, type RecState,
} from '../shared/recorder-machine';
import { createAudioMixer, type AudioMixer } from './audio-mixer';
import { loadBackgroundImage } from './background';
import { hiddenVideo, openScreenStream, stopStream } from './capture';
import { createCompositor, type Compositor } from './compositor';
import { listDevices, openCamera, openMic, primeDevicePermissions } from './devices';
import { createAnnotationLayer } from './annotation-layer';
import { createInputEffects } from './input-effects';
import { createLiveSwitch } from './live-switch';
import { createSystemAudio } from './system-audio';
import { createLibraryUi } from './library-ui';
import { createRecorder, type Recorder } from './recorder';
import { bindThemeToggle, applyTheme } from './theme';
import { createSegmenter, type Segmenter } from './segmenter';
import {
  applyCaptureMode, applyOutputFormat, syncQuickToggles, bindOverlayDrag, bindSettings, fillDeviceSelect, getEls, renderHotkeyStatus, renderSources, setButtons, setStatus,
  setTimer, showCountdown,
} from './ui';

async function main(): Promise<void> {
  const els = getEls();
  const api = window.recorderApi;
  const settings: Settings = await api.getSettings();
  applyTheme(settings.theme);
  const clock = createElapsedClock(() => performance.now());
  const screenVideo = hiddenVideo();
  const cameraVideo = hiddenVideo();
  const comp: Compositor = createCompositor({ canvas: els.preview, ...qualityPreset(settings.quality) });
  comp.setRegionListener((r) => { void api.captureFrameUpdate(r).catch(() => undefined); });

  let state: RecState = initialState();
  let screenStream: MediaStream | null = null;
  let cameraStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;
  let segmenter: Segmenter | null = null;
  let segmenterLoading = false;
  let bgImage: ImageBitmap | null = null;
  let recorder: Recorder | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let ffmpeg: FfmpegStatus = { available: false, version: null };
  let canExport = false;
  let exporting = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let startPromise: Promise<void> | null = null;
  let inputStarted = false;
  const cameraGen = createGenerationGuard();
  const micGen = createGenerationGuard();
  const screenGen = createGenerationGuard();
  const mixer: AudioMixer = createAudioMixer((m) => status(m));
  window.addEventListener('pagehide', () => mixer.dispose());

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.textContent = 'Retry save';
  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.textContent = 'Discard recording';
  retryBtn.hidden = true;
  discardBtn.hidden = true;
  els.status.after(retryBtn, discardBtn);
  const showSaveChoices = (on: boolean) => { retryBtn.hidden = !on; discardBtn.hidden = !on; };

  const status = (t: string) => setStatus(els, t);
  const library = createLibraryUi(api, status, () => ffmpeg.available);
  const trimOpenBtn = document.getElementById('trim-open') as HTMLButtonElement;
  // Cursor halo / ripples / keystrokes / auto-zoom: the input hook runs only between start() and stop().
  const inputFx = createInputEffects(api, comp, settings, status);
  // Pen strokes from the draw overlay are composited into the canvas (the overlay window is hidden from capture).
  const annotations = createAnnotationLayer(api, () => settings.sourceId, status);
  comp.setAnnotations(annotations);

  // Floating always-on-top camera bubble: lives outside this window so it survives minimizing it.
  let floatingOn = false;
  const syncFloating = () => {
    const want = (state.phase === 'recording' || state.phase === 'paused')
      && settings.captureMode === 'screen' && settings.outputFormat === 'pc' && settings.cameraEnabled && cameraStream !== null;
    const cfg = {
      cameraDeviceId: settings.cameraDeviceId, shape: settings.overlay.shape, sizePercent: settings.overlay.sizePercent,
      pos: settings.overlay.pos, corner: settings.overlay.corner,
      mirror: settings.overlay.mirror, border: settings.overlay.border,
      background: { ...settings.background },
    };
    if (want && !floatingOn) { floatingOn = true; void api.overlayShow(cfg).catch(() => undefined); }
    else if (want) void api.overlayUpdate(cfg).catch(() => undefined);
    else if (floatingOn) { floatingOn = false; void api.overlayHide().catch(() => undefined); }
  };

  // Floating control toolbar (pause / mode / stop) over the desktop: only while recording or paused.
  let lastControlHud: ControlHudState | null = null;
  const syncControlHud = () => {
    const live = state.phase === 'recording' || state.phase === 'paused';
    const next: ControlHudState | null = live ? {
      phase: state.phase as 'recording' | 'paused', mode: settings.captureMode,
      canSwitch: liveSwitchDecision(state.phase, settings.captureMode, screenStream !== null, !!settings.sourceId, settings.cameraEnabled).allowed,
    } : null;
    if (sameControlHudState(lastControlHud, next)) return;
    lastControlHud = next;
    try { void api.controlHudState(next).catch(() => undefined); } catch { /* toolbar is optional */ }
  };

  const pushState = (skipFloating = false) => {
    syncControlHud();
    if (skipFloating !== true) syncFloating();
    comp.update({
      captureMode: settings.captureMode, outputFormat: settings.outputFormat, mobile: settings.mobile,
      cameraEnabled: settings.cameraEnabled,
      overlay: settings.overlay,
      background: { mode: settings.background.mode, color: settings.background.color, blurRadius: settings.background.blurRadius, image: bgImage },
    });
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { api.saveSettings(settings).catch((e) => status(`Could not save settings: ${e}`)); }, 300);
  };
  bindThemeToggle(document.getElementById('theme-toggle') as HTMLButtonElement, settings, scheduleSave);
  // Dragging the floating bubble moves the overlay in the recording (echo to the bubble is skipped).
  api.onOverlayMoved((pos) => {
    settings.overlay.pos = pos;
    pushState(true);
    scheduleSave();
  });

  // ---- devices / streams ----
  async function ensureSegmenter(): Promise<void> {
    if (segmenter || segmenterLoading) return;
    if (settings.background.mode === 'none' || !settings.cameraEnabled) return;
    segmenterLoading = true;
    try {
      status('Loading background model...');
      segmenter = await createSegmenter();
      comp.setCamera(cameraStream ? cameraVideo : null, segmenter);
      status('');
    } catch (e) {
      status(`Background model failed to load: ${e instanceof Error ? e.message : e}`);
    } finally {
      segmenterLoading = false;
    }
  }

  async function applyCamera(): Promise<void> {
    const gen = cameraGen.next();
    stopStream(cameraStream);
    cameraStream = null;
    cameraVideo.srcObject = null;
    if (settings.cameraEnabled) {
      let stream: MediaStream | null = null;
      try {
        stream = await openCamera(settings.cameraDeviceId, settings.captureMode === 'camera' && settings.outputFormat === 'mobile');
        if (!cameraGen.isCurrent(gen)) { stopStream(stream); return; }
        cameraStream = stream;
        cameraVideo.srcObject = stream;
        await cameraVideo.play().catch(() => undefined);
      } catch (e) {
        if (!cameraGen.isCurrent(gen)) return;
        status(`Camera unavailable: ${e instanceof Error ? e.message : e}`);
      }
      if (!cameraGen.isCurrent(gen)) return;
    }
    comp.setCamera(cameraStream ? cameraVideo : null, segmenter);
    pushState();
    void ensureSegmenter();
  }

  async function applyMic(): Promise<void> {
    if (state.phase === 'recording' || state.phase === 'paused') {
      mixer.setMicEnabled(settings.micEnabled);
      micStream?.getAudioTracks().forEach((t) => { t.enabled = settings.micEnabled; });
      return;
    }
    const gen = micGen.next();
    mixer.setMic(null);
    stopStream(micStream);
    micStream = null;
    mixer.setMicEnabled(settings.micEnabled);
    try {
      const stream = await openMic(settings.micDeviceId, settings.micProcessing);
      if (!micGen.isCurrent(gen)) { stopStream(stream); return; }
      micStream = stream;
      micStream.getAudioTracks().forEach((t) => { t.enabled = settings.micEnabled; });
      mixer.setMic(micStream);
    } catch (e) {
      if (!micGen.isCurrent(gen)) return;
      status(`Microphone unavailable: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function applyBackgroundImage(): Promise<void> {
    bgImage?.close();
    bgImage = null;
    if (settings.background.mode === 'image' && settings.background.imagePath) {
      try {
        bgImage = await loadBackgroundImage(settings.background.imagePath);
      } catch (e) {
        status(`Could not load image: ${e instanceof Error ? e.message : e}`);
      }
    }
    pushState();
  }

  async function selectSource(id: string): Promise<void> {
    settings.sourceId = id;
    scheduleSave();
    const gen = screenGen.next();
    comp.setScreen(null);
    stopStream(screenStream);
    screenStream = null;
    try {
      const stream = await openScreenStream(id, qualityPreset(settings.quality).fps);
      if (!screenGen.isCurrent(gen)) { stopStream(stream); return; }
      screenStream = stream;
      screenVideo.srcObject = screenStream;
      await screenVideo.play().catch(() => undefined);
      comp.setScreen(screenVideo);
      comp.start();
    } catch (e) {
      if (!screenGen.isCurrent(gen)) return;
      status(`Cannot capture this source: ${e instanceof Error ? e.message : e}`);
    }
  }

  const systemAudio = createSystemAudio({
    settings, mixer, status,
    phase: () => state.phase,
    listSourceIds: async () => (await api.listSources()).map((s) => s.id),
    meter: document.getElementById('system-audio-meter'),
  });

  // Live camera-only <-> screen + camera while recording: the canvas size stays locked, only what is drawn changes.
  const liveSwitch = createLiveSwitch({
    settings,
    phase: () => state.phase,
    hasScreenStream: () => screenStream !== null,
    hasCameraStream: () => cameraStream !== null,
    startScreen: async (id) => { await selectSource(id); return screenStream !== null; },
    applyCamera,
    pushState: () => pushState(),
    syncUi: () => {
      els.captureMode.value = settings.captureMode;
      applyCaptureMode(els, settings.captureMode);
      els.cameraToggle.checked = settings.cameraEnabled || settings.captureMode === 'camera';
      applyOutputFormat(els, settings);
      syncQuickToggles(els, settings);
      scheduleSave();
    },
    status,
    startInputIfNeeded: () => { if (!inputStarted) { inputStarted = true; void inputFx.start(); } },
  });

  async function refreshSources(): Promise<void> {
    try {
      const list = await api.listSources();
      renderSources(list, els, settings.sourceId, (id) => { void selectSource(id); });
      if (settings.captureMode === 'screen' && settings.sourceId && list.some((s) => s.id === settings.sourceId) && !screenStream) {
        void selectSource(settings.sourceId);
      }
    } catch (e) {
      status(`Cannot list sources: ${e}`);
    }
  }

  /** Opens the phone-shaped browser window, then selects it as the source and switches to the fitted mobile format. */
  async function openMobileBrowser(): Promise<void> {
    try {
      const { sourceId } = await api.openMobileBrowser();
      if (!sourceId) { status('Mobile browser could not be opened'); return; }
      const screenMode = settings.captureMode === 'screen';
      if (screenMode) {
        settings.outputFormat = 'mobile';
        settings.mobile.framing = 'fit';
        els.outputFormat.value = 'mobile';
        syncQuickToggles(els, settings);
        els.mobileFraming.value = 'fit';
        applyOutputFormat(els, settings);
        pushState();
        scheduleSave();
      }
      // A new window can take a moment to appear in the desktop capturer list.
      for (let i = 0; i < 10; i++) {
        const list = await api.listSources();
        if (list.some((s) => s.id === sourceId)) {
          settings.sourceId = sourceId;
          renderSources(list, els, sourceId, (id) => { void selectSource(id); });
          if (screenMode) await selectSource(sourceId);
          status('Mobile browser ready: it is the capture source');
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      await refreshSources();
      status('Mobile browser opened but not listed yet: press Refresh and select it');
    } catch (e) {
      status(`Cannot open mobile browser: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Release the screen capture so no share indicator stays on (PC sound has its own capture). */
  function releaseScreen(): void {
    screenGen.next();
    comp.setScreen(null);
    stopStream(screenStream);
    screenStream = null;
  }

  function applyMode(): void {
    if (settings.captureMode === 'camera') {
      releaseScreen();
      settings.cameraEnabled = true;
      pushState();
      comp.start();
      void applyCamera();
    } else {
      if (liveSwitch.cameraForced()) { // the camera was only opened for a live switch: restore the user's choice
        liveSwitch.clearForced();
        settings.cameraEnabled = false;
        els.cameraToggle.checked = false;
        pushState();
        void applyCamera();
      }
      if (settings.sourceId && !screenStream) void selectSource(settings.sourceId);
    }
  }

  // ---- recording state ----
  function dispatch(ev: RecEvent): void {
    const prev = state;
    state = reduce(state, ev);
    if (state === prev) return;
    setButtons(els, state);
    syncFloating();
    syncControlHud();
    showCountdown(els, state.phase === 'countdown' ? state.remaining : null);
    if (prev.phase === 'countdown' && state.phase === 'recording') {
      startPromise = beginRecording().finally(() => { startPromise = null; });
    }
    if (state.phase === 'idle' && countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  async function beginRecording(): Promise<void> {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    comp.lockSize(true);
    mixer.setMicEnabled(settings.micEnabled);
    recorder = createRecorder({
      canvasStream: comp.captureStream(),
      audioTrack: settings.videoOnly ? null : mixer.track(),
      videoBitsPerSecond: qualityPreset(settings.quality).videoBitsPerSecond,
      onError: (m) => status(m),
    });
    try {
      await recorder.start();
      clock.start();
      status('Recording...');
      inputStarted = settings.captureMode === 'screen';
      void inputFx.start();
    } catch (e) {
      status(`Cannot start recording: ${e instanceof Error ? e.message : e}`);
      recorder = null;
      comp.lockSize(false);
      dispatch({ type: 'STOP' });
      dispatch({ type: 'STOPPED' });
    }
  }

  function reportResult(res: FinishResult): void {
    showSaveChoices(false);
    if (res.status === 'saved') {
      status(`Saved ${res.path}${res.note ? ` (${res.note})` : ''}`);
      canExport = true;
      syncExportButtons();
      void library.refresh();
    }
    else if (res.status === 'cancelled') {
      status('Save cancelled. The recording is kept: retry the save or discard it.');
      showSaveChoices(true);
    } else if (res.retryable) {
      status(`Save failed: ${res.message}. The recording is kept: retry the save or discard it.`);
      showSaveChoices(true);
    } else status(`Error: ${res.message}`);
  }

  // ---- export / screenshot ----
  function syncExportButtons(): void {
    els.exportRow.hidden = !ffmpeg.available;
    els.exportMp4.disabled = els.exportGif.disabled = !canExport || exporting;
    trimOpenBtn.disabled = !canExport || exporting;
  }

  async function runExport(format: ExportFormat): Promise<void> {
    if (exporting || !canExport) return;
    exporting = true;
    syncExportButtons();
    status(`Exporting ${format.toUpperCase()}...`);
    try {
      const res = await api.exportRecording({ format });
      if (res.status === 'saved') status(`Exported ${res.path}`);
      else if (res.status === 'cancelled') status('Export cancelled.');
      else status(`Export failed: ${res.message}`);
    } catch (e) {
      status(`Export failed: ${e instanceof Error ? e.message : e}`);
    }
    exporting = false;
    syncExportButtons();
  }

  async function takeScreenshot(): Promise<void> {
    // The button stays enabled (hotkeys use it too): say plainly when the canvas has nothing but black.
    const live = settings.captureMode === 'camera' ? cameraStream !== null : screenStream !== null;
    if (!live) {
      status(settings.captureMode === 'camera'
        ? 'Screenshot skipped: the camera is not available, so there is nothing to capture.'
        : 'Screenshot skipped: no screen or window is being captured. Choose a source first.');
      return;
    }
    try {
      const blob = await comp.snapshot();
      if (!blob) { status('Screenshot failed: nothing to capture'); return; }
      const res = await api.saveScreenshot(await blob.arrayBuffer());
      status(`Screenshot saved ${res.path}`);
    } catch (e) {
      status(`Screenshot failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Global hotkeys arrive as buttons presses so they obey exactly the same enabled/disabled rules. */
  function runHotkey(action: HotkeyAction): void {
    if (action === 'toggle') (state.phase === 'idle' ? els.start : els.stop).click();
    else if (action === 'pause') els.pause.click();
    else if (action === 'screenshot') void takeScreenshot();
    else if (action === 'toggleCamera') {
      if (els.quickMode.disabled) return; // countdown / stopping
      els.quickMode.click(); // same path as the button (live switch while recording, normal switch when idle)
      if (state.phase === 'idle') status(captureModeLabel(settings.captureMode)); // the live switch reports for itself
    } else if (action === 'zoomIn' || action === 'zoomOut' || action === 'zoomReset') {
      const msg = inputFx.zoom(action);
      if (msg) status(msg);
    }
  }

  async function stopRecording(): Promise<void> {
    // Stop clicked while the recorder is still starting: let start finish, then stop right after.
    if (startPromise) await startPromise;
    dispatch({ type: 'STOP' });
    if (state.phase !== 'stopping' || !recorder) return;
    clock.stop();
    inputFx.stop();
    status('Finishing...');
    const r = recorder;
    try {
      reportResult(await r.stop(ffmpeg.available));
    } catch (e) {
      status(`Error: ${e instanceof Error ? e.message : e}`);
      showSaveChoices(r.hasPending());
    }
    if (!r.hasPending()) recorder = null;
    comp.lockSize(false);
    inputStarted = false;
    if (settings.captureMode === 'camera') releaseScreen(); // camera-only when idle never keeps a screen share open
    scheduleSave();
    clock.reset();
    setTimer(els, formatElapsed(0));
    dispatch({ type: 'STOPPED' });
  }

  retryBtn.onclick = async () => {
    if (!recorder) return;
    retryBtn.disabled = true;
    try {
      reportResult(await recorder.retrySave(ffmpeg.available));
    } catch (e) {
      status(`Error: ${e instanceof Error ? e.message : e}`);
    }
    if (!recorder.hasPending()) { recorder = null; showSaveChoices(false); }
    retryBtn.disabled = false;
  };
  discardBtn.onclick = async () => {
    const r = recorder;
    recorder = null;
    showSaveChoices(false);
    if (r) await r.discardPending();
    status('Recording discarded.');
  };

  els.start.onclick = () => {
    if (settings.captureMode === 'camera') {
      if (!cameraStream) { status('Camera not available.'); return; }
    } else if (!settings.sourceId || !screenStream) { status('Choose a screen or window first.'); return; }
    if (recorder?.hasPending()) { status('Retry the save or discard the previous recording first.'); return; }
    dispatch({ type: 'START' });
    if (state.phase === 'countdown') {
      status('');
      countdownTimer = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    }
  };
  els.pause.onclick = () => {
    if (state.phase === 'recording') { dispatch({ type: 'PAUSE' }); recorder?.pause(); clock.pause(); }
    else if (state.phase === 'paused') { dispatch({ type: 'RESUME' }); recorder?.resume(); clock.resume(); }
  };
  els.stop.onclick = () => {
    if (state.phase === 'countdown') dispatch({ type: 'CANCEL' });
    else void stopRecording();
  };
  els.refreshSources.onclick = () => { void refreshSources(); };
  els.openMobileBrowser.onclick = () => { void openMobileBrowser(); };
  els.screenshot.onclick = () => { void takeScreenshot(); };
  els.exportMp4.onclick = () => { void runExport('mp4'); };
  els.exportGif.onclick = () => { void runExport('gif'); };
  api.onHotkey(runHotkey);
  // Floating toolbar clicks go through the very same buttons as the UI and hotkeys.
  api.onControlCommand((cmd) => {
    const cmdName = parseControlHudCommand(cmd);
    console.log('[control-hud] renderer received', cmd, '->', cmdName, 'phase', state.phase, 'modeBtnDisabled', els.quickMode.disabled);
    if (cmdName === 'pause-toggle') els.pause.click();
    else if (cmdName === 'stop') els.stop.click();
    else if (cmdName === 'switch-mode' && !els.quickMode.disabled) els.quickMode.click();
  });
  api.onHotkeyStatus((s) => renderHotkeyStatus(els, s.failed));
  api.getHotkeyStatus().then((s) => renderHotkeyStatus(els, s.failed)).catch(() => undefined);
  els.bgImageBtn.onclick = async () => {
    const res = await api.pickImage();
    if (!res) return;
    settings.background.imagePath = res.path;
    settings.background.mode = 'image';
    els.bgMode.value = 'image';
    await applyBackgroundImage();
    scheduleSave();
  };

  setInterval(() => {
    if (state.phase === 'recording' || state.phase === 'paused') setTimer(els, formatElapsed(clock.elapsedMs()));
  }, 250);

  // ---- init ----
  setButtons(els, state);
  setTimer(els, formatElapsed(0));
  void library.refresh();
  api.checkFfmpeg().then((f) => {
    ffmpeg = f;
    syncExportButtons();
    void library.refresh(); // re-render: per-entry export/trim need ffmpeg
    els.ffmpegNote.textContent = f.available
      ? `ffmpeg ${f.version} found: recordings are exported as MP4.`
      : 'ffmpeg not found: recordings are saved as WebM.';
  }).catch(() => undefined);

  await primeDevicePermissions();
  const { cameras, mics } = await listDevices();
  fillDeviceSelect(els.cameraSelect, cameras, settings.cameraDeviceId);
  fillDeviceSelect(els.micSelect, mics, settings.micDeviceId);
  if (!settings.cameraDeviceId && cameras[0]) settings.cameraDeviceId = els.cameraSelect.value || null;
  if (!settings.micDeviceId && mics[0]) settings.micDeviceId = els.micSelect.value || null;

  bindSettings(els, settings, (kind) => {
    if (kind === 'camera') void applyCamera();
    else if (kind === 'mic') void applyMic();
    else if (kind === 'mode') applyMode();
    else if (kind === 'quality') {
      comp.setQuality(qualityPreset(settings.quality));
      if (settings.captureMode === 'screen' && settings.sourceId && screenStream) void selectSource(settings.sourceId);
    }
    else if (kind === 'system-audio') void systemAudio.sync();
    else if (kind === 'other') void systemAudio.sync(); // 'Video only' stops/starts the PC-sound capture too
    else if (kind === 'image') { void applyBackgroundImage(); void ensureSegmenter(); }
    pushState();
    scheduleSave();
  }, status, () => {
    if (state.phase === 'idle') return false;
    void liveSwitch.run();
    return true;
  });

  bindOverlayDrag(els.preview, settings, { onMove: () => pushState(), onCommit: scheduleSave });

  if (settings.captureMode === 'camera') settings.cameraEnabled = true;
  pushState();
  if (settings.captureMode === 'camera') comp.start();
  await Promise.all([applyCamera(), applyMic(), applyBackgroundImage(), refreshSources(), systemAudio.sync()]);
}

main().catch((e) => {
  console.error(e);
  const s = document.getElementById('status');
  if (s) s.textContent = `Startup error: ${e instanceof Error ? e.message : e}`;
});
