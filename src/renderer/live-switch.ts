import type { Settings } from '../shared/ipc';
import { liveSwitchDecision } from '../shared/quick-toggles';

export interface LiveSwitchDeps {
  settings: Settings;
  phase(): string;
  hasScreenStream(): boolean;
  hasCameraStream(): boolean;
  /** Opens the screen source (no audio changes while the mode is still camera); true when a stream is running. */
  startScreen(id: string): Promise<boolean>;
  /** Re-opens/closes the camera according to settings.cameraEnabled and pushes the compositor state. */
  applyCamera(): Promise<void>;
  pushState(): void;
  syncUi(): void;
  status(t: string): void;
  /** Input effects (cursor, zoom) are screen-only and are not running when the recording began camera-only. */
  startInputIfNeeded(): void;
}

export interface LiveSwitch {
  /** Switch camera-only <-> screen + camera during a recording. Never changes the canvas size. */
  run(): Promise<void>;
  /** The camera bubble was force-opened by a live switch and should go off again when returning to screen. */
  cameraForced(): boolean;
  clearForced(): void;
}

export function createLiveSwitch(d: LiveSwitchDeps): LiveSwitch {
  let busy = false;
  let forced = false;
  return {
    cameraForced: () => forced,
    clearForced: () => { forced = false; },
    async run() {
      if (busy) return;
      const s = d.settings;
      const dec = liveSwitchDecision(d.phase(), s.captureMode, d.hasScreenStream(), !!s.sourceId, s.cameraEnabled, forced);
      if (!dec.allowed) { if (dec.message) d.status(dec.message); return; }
      busy = true;
      try {
        if (dec.needScreenStart) {
          d.status('Starting screen capture...');
          const ok = await d.startScreen(s.sourceId!);
          if (!ok || (d.phase() !== 'recording' && d.phase() !== 'paused')) return; // selectSource already reported the failure
        }
        if (dec.nextMode === 'camera') {
          if (dec.needCameraOpen) s.cameraEnabled = true;
          if (!d.hasCameraStream()) await d.applyCamera();
          if (!d.hasCameraStream()) { // camera unavailable: stay on screen (applyCamera reported why)
            if (dec.needCameraOpen) s.cameraEnabled = false;
            d.pushState();
            return;
          }
          if (dec.needCameraOpen) forced = true;
          s.captureMode = 'camera';
        } else {
          s.captureMode = 'screen';
          d.startInputIfNeeded();
          if (dec.restoreCameraOff) { forced = false; s.cameraEnabled = false; await d.applyCamera(); }
        }
        d.pushState();
        d.syncUi();
        d.status(dec.message);
      } finally {
        busy = false;
      }
    },
  };
}
