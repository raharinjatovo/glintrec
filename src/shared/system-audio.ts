/** Pure decisions for the "system audio (PC sound)" option; the capture itself lives in renderer/system-audio.ts. */

export interface SystemAudioSettings {
  systemAudioEnabled: boolean;
  videoOnly: boolean;
}

/** System audio is captured when the option is on and the recording is not video-only (video only always wins). */
export function wantsSystemAudio(s: SystemAudioSettings): boolean {
  return s.systemAudioEnabled && !s.videoOnly;
}

export type SystemAudioAction = 'open' | 'close' | 'keep';

/**
 * What to do to reach the wanted state. The capture is never opened or closed while a recording
 * is counting down, running, paused or stopping, so the audio stays continuous.
 */
export function systemAudioAction(want: boolean, active: boolean, phase: string): SystemAudioAction {
  if (phase !== 'idle') return 'keep';
  if (want && !active) return 'open';
  if (!want && active) return 'close';
  return 'keep';
}

/**
 * Loopback needs some video source to ask getDisplayMedia for (the video track is dropped at once).
 * Prefer the selected source, else the first screen, else the first window.
 */
export function pickAudioHostSource(selected: string | null, ids: readonly string[]): string | null {
  if (selected && ids.includes(selected)) return selected;
  return ids.find((id) => id.startsWith('screen:')) ?? ids[0] ?? null;
}

export type SilenceEvent = 'silent' | 'sound' | null;

/**
 * Watches the level (RMS, 0..1) of the PC-sound capture. Reports 'silent' once after `limitMs` of digital silence and
 * 'sound' once when sound comes back after such a report; null otherwise. Silence is not an error (a paused video is
 * silent): it only lets the UI hint at a wrong output device.
 */
export function createSilenceWatch(limitMs: number, floor = 1e-4): (rms: number, nowMs: number) => SilenceEvent {
  let since: number | null = null;
  let reported = false;
  return (rms, nowMs) => {
    if (rms >= floor) {
      since = null;
      if (!reported) return null;
      reported = false;
      return 'sound';
    }
    since ??= nowMs;
    if (!reported && nowMs - since >= limitMs) { reported = true; return 'silent'; }
    return null;
  };
}
