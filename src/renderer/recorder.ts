import type { FinishResult } from '../shared/ipc';
import { stopRecorder } from '../shared/async-guards';
import { timestampName } from '../shared/format';

export { timestampName };

export interface RecorderOptions {
  canvasStream: MediaStream;
  /** The mixed (mic + system) audio track from the audio mixer; null = record without audio. */
  audioTrack: MediaStreamTrack | null;
  /** Defaults to 8 Mbit/s; comes from the quality preset. */
  videoBitsPerSecond?: number;
  onError(msg: string): void;
}
export interface Recorder {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  /** Stop and save. On 'cancelled' or a retryable error the temp recording is kept: see retrySave/discardPending. */
  stop(wantMp4: boolean): Promise<FinishResult>;
  /** True while a stopped recording is waiting to be saved or discarded. */
  hasPending(): boolean;
  retrySave(wantMp4: boolean): Promise<FinishResult>;
  discardPending(): Promise<void>;
  abort(): Promise<void>;
}

export const STOP_TIMEOUT_MS = 10_000;

const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function createRecorder(opts: RecorderOptions): Recorder {
  let rec: MediaRecorder | null = null;
  let sessionId: string | null = null;
  let pendingId: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  let failed = false;

  const fail = (msg: string) => {
    if (failed) return;
    failed = true;
    opts.onError(msg);
  };

  const finish = async (id: string, wantMp4: boolean): Promise<FinishResult> => {
    pendingId = id; // stays set if the IPC call itself rejects, so the user can still retry or discard
    const res = await window.recorderApi.finishRecording({ sessionId: id, suggestedName: timestampName(new Date()), wantMp4 });
    const keep = res.status === 'cancelled' || (res.status === 'error' && res.retryable === true);
    pendingId = keep ? id : null;
    return res;
  };

  return {
    async start() {
      const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
      if (!mimeType) throw new Error('No supported WebM recording format');
      const tracks = [...opts.canvasStream.getVideoTracks(), ...(opts.audioTrack ? [opts.audioTrack] : [])];
      const stream = new MediaStream(tracks);
      // Create the MediaRecorder before the main-process session so a constructor failure leaks nothing.
      const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: opts.videoBitsPerSecond ?? 8_000_000, audioBitsPerSecond: 128_000 });
      const { sessionId: id } = await window.recorderApi.beginRecording();
      try {
        mr.ondataavailable = (ev) => {
          if (ev.data.size === 0) return;
          const blob = ev.data;
          chain = chain.then(async () => {
            if (failed) return;
            try {
              await window.recorderApi.writeChunk(id, await blob.arrayBuffer());
            } catch (e) {
              fail(`Writing recording failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          });
        };
        // A MediaRecorder error ends recording by itself; chunks already flushed are kept and saved on stop().
        mr.onerror = () => opts.onError('MediaRecorder error: the recording was interrupted');
        mr.start(1000);
      } catch (e) {
        mr.ondataavailable = null;
        await window.recorderApi.abortRecording(id).catch(() => undefined);
        throw e;
      }
      rec = mr;
      sessionId = id;
    },
    pause() { if (rec?.state === 'recording') rec.pause(); },
    resume() { if (rec?.state === 'paused') rec.resume(); },
    async stop(wantMp4) {
      if (!rec || !sessionId) return { status: 'error', message: 'Not recording' };
      const r = rec;
      const id = sessionId;
      const outcome = await stopRecorder(r, STOP_TIMEOUT_MS);
      r.ondataavailable = null;
      if (outcome === 'error') opts.onError('Recorder error while stopping; saving what was recorded');
      else if (outcome === 'timeout') opts.onError('Recorder did not stop in time; saving what was recorded');
      await chain;
      rec = null;
      sessionId = null;
      if (failed) {
        await window.recorderApi.abortRecording(id).catch(() => undefined);
        return { status: 'error', message: 'Recording failed while writing to disk' };
      }
      return finish(id, wantMp4);
    },
    hasPending: () => pendingId !== null,
    async retrySave(wantMp4) {
      if (!pendingId) return { status: 'error', message: 'No recording to save' };
      return finish(pendingId, wantMp4);
    },
    async discardPending() {
      const id = pendingId;
      pendingId = null;
      if (id) await window.recorderApi.abortRecording(id).catch(() => undefined);
    },
    async abort() {
      const r = rec;
      const id = sessionId;
      rec = null;
      sessionId = null;
      if (r && r.state !== 'inactive') {
        r.ondataavailable = null;
        r.stop();
      }
      await chain.catch(() => undefined);
      if (id) await window.recorderApi.abortRecording(id).catch(() => undefined);
    },
  };
}
