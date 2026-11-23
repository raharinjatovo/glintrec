/** Pure bookkeeping for the audio mixer (the Web Audio graph itself lives in renderer/audio-mixer.ts). */

/** Gain applied to the microphone input: 0 when muted, 1 otherwise. */
export function micGain(enabled: boolean): number {
  return enabled ? 1 : 0;
}

export interface AudioStreamLike {
  getAudioTracks(): Array<{ readyState?: string }>;
}

/** A stream can feed the mixer only if it still has at least one live audio track. */
export function hasLiveAudio(s: AudioStreamLike | null): boolean {
  return !!s && s.getAudioTracks().some((t) => t.readyState !== 'ended');
}

export interface InputSlot<S extends AudioStreamLike> {
  /** Replace the input (null removes it). The previous node is always disconnected first. */
  set(stream: S | null): void;
  readonly stream: S | null;
  readonly connected: boolean;
}

/**
 * One mixer input: holds at most one connected node. Setting a new stream disconnects the old node;
 * a stream without a live audio track stays unconnected; setting the same stream again is a no-op.
 */
export function createInputSlot<S extends AudioStreamLike, N>(
  connect: (s: S) => N, disconnect: (n: N) => void,
): InputSlot<S> {
  let stream: S | null = null;
  let node: N | null = null;
  return {
    set(next) {
      if (next === stream && (node !== null || !hasLiveAudio(next))) return;
      if (node !== null) { disconnect(node); node = null; }
      stream = next;
      if (next && hasLiveAudio(next)) node = connect(next);
    },
    get stream() { return stream; },
    get connected() { return node !== null; },
  };
}
