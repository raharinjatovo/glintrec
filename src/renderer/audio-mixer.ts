import { createInputSlot, micGain } from '../shared/audio-mix';

/**
 * Mixes the microphone and the system (loopback) audio into ONE track for MediaRecorder.
 * Graph: mic -> micGain -\
 *                          >-> MediaStreamAudioDestinationNode (the only output)
 *        system -> sysGain -/
 * Nothing is connected to ctx.destination, so the captured audio is never played back (no feedback).
 * The mixer does not own the input streams: the caller stops them. dispose() stops only the mixed track.
 */
export interface AudioMixer {
  /** Replace (or remove with null) the microphone input; safe to call at any time. */
  setMic(stream: MediaStream | null): void;
  /** Replace (or remove with null) the system-audio input (audio track of the display stream). */
  setSystem(stream: MediaStream | null): void;
  /** Mute through the gain node (the track keeps running, so the recording has no gap in its timeline). */
  setMicEnabled(enabled: boolean): void;
  /** The single mixed audio track (silence when no input is connected). Null once disposed. */
  track(): MediaStreamTrack | null;
  dispose(): void;
}

/**
 * AudioContext for capture-only graphs (mixer, level meter): nothing is ever played, so it is created WITHOUT an output
 * device (sinkId 'none'). A context bound to the default speakers dies with "The AudioContext encountered an error from the
 * audio device" when the Windows output changes or fails (Bluetooth, HDMI, exclusive mode...), which silenced the recording.
 */
export function createCaptureContext(): AudioContext {
  try {
    return new AudioContext({ sinkId: { type: 'none' }, latencyHint: 'playback' } as AudioContextOptions);
  } catch {
    return new AudioContext(); // engine without sinkId support: default device
  }
}

export function createAudioMixer(onProblem?: (msg: string) => void): AudioMixer {
  const ctx = createCaptureContext();
  const dest = ctx.createMediaStreamDestination();
  const micGainNode = ctx.createGain();
  const sysGainNode = ctx.createGain();
  micGainNode.connect(dest);
  sysGainNode.connect(dest);
  let disposed = false;

  const wake = () => { if (!disposed && ctx.state === 'suspended') void ctx.resume().catch(() => undefined); };
  const slot = (gain: GainNode) => createInputSlot<MediaStream, MediaStreamAudioSourceNode>(
    (s) => { const n = ctx.createMediaStreamSource(s); n.connect(gain); return n; },
    (n) => { n.disconnect(); },
  );
  const mic = slot(micGainNode);
  const sys = slot(sysGainNode);
  wake();
  ctx.addEventListener('statechange', wake);
  ctx.addEventListener('error', () => { onProblem?.('Audio engine error: restart the app if the recording has no sound'); wake(); });

  return {
    setMic(s) { if (disposed) return; mic.set(s); wake(); },
    setSystem(s) { if (disposed) return; sys.set(s); wake(); },
    setMicEnabled(enabled) { micGainNode.gain.value = micGain(enabled); },
    track() { return disposed ? null : dest.stream.getAudioTracks()[0] ?? null; },
    dispose() {
      if (disposed) return;
      disposed = true;
      mic.set(null);
      sys.set(null);
      micGainNode.disconnect();
      sysGainNode.disconnect();
      dest.stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}
