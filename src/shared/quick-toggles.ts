import type { CaptureMode } from './ipc';

export function nextCaptureMode(mode: CaptureMode): CaptureMode {
  return mode === 'camera' ? 'screen' : 'camera';
}

/** Button labels show the current state (aria-pressed marks camera-only as the "on" side). */
export function captureModeLabel(mode: CaptureMode): string {
  return mode === 'camera' ? 'Camera only' : 'Screen + camera';
}

export interface LiveSwitchDecision {
  allowed: boolean;
  nextMode: CaptureMode;
  /** No screen stream exists yet (recording started camera-only): open the chosen source first. */
  needScreenStart: boolean;
  /** Going to camera-only while the camera bubble is off: open the camera. */
  needCameraOpen: boolean;
  /** Going back to screen + camera after the camera was force-opened by an earlier live switch: turn it off again. */
  restoreCameraOff: boolean;
  /** Short status text (reason when not allowed, new mode otherwise); '' when nothing to say. */
  message: string;
}

/** Whether a live camera-only <-> screen + camera switch is possible, and which side effects it needs. */
export function liveSwitchDecision(
  phase: string, currentMode: CaptureMode, hasScreenStream: boolean, hasSourceId: boolean, cameraEnabled: boolean, cameraForced = false,
): LiveSwitchDecision {
  const nextMode = nextCaptureMode(currentMode);
  const none: LiveSwitchDecision = { allowed: false, nextMode: currentMode, needScreenStart: false, needCameraOpen: false, restoreCameraOff: false, message: '' };
  if (phase !== 'recording' && phase !== 'paused') return none;
  if (nextMode === 'screen') {
    if (!hasScreenStream && !hasSourceId) return { ...none, message: 'Pick a screen source first' };
    return { allowed: true, nextMode, needScreenStart: !hasScreenStream, needCameraOpen: false, restoreCameraOff: cameraForced, message: captureModeLabel(nextMode) };
  }
  return { allowed: true, nextMode, needScreenStart: false, needCameraOpen: !cameraEnabled, restoreCameraOff: false, message: captureModeLabel(nextMode) };
}
