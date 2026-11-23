import { createGenerationGuard } from '../shared/async-guards';
import type { Settings } from '../shared/ipc';
import { createSilenceWatch, pickAudioHostSource, systemAudioAction, wantsSystemAudio } from '../shared/system-audio';
import { createCaptureContext, type AudioMixer } from './audio-mixer';
import { openSystemAudioStream, stopStream } from './capture';

const SILENCE_NOTICE_MS = 8000;

export interface SystemAudio {
  /** Open or close the PC-sound capture so it matches the settings (no-op while a recording is running). */
  sync(): Promise<void>;
  /** The capture is running and feeds the mixer. */
  active(): boolean;
}

interface Deps {
  settings: Settings;
  mixer: AudioMixer;
  phase(): string;
  listSourceIds(): Promise<string[]>;
  status(t: string): void;
  /** Optional level bar, driven only while the capture exists. */
  meter: HTMLElement | null;
}

/**
 * Owns the system-audio stream, independent from the screen/camera streams: it keeps running across
 * camera <-> screen live switches, so the recorded audio is continuous.
 */
export function createSystemAudio(d: Deps): SystemAudio {
  const gen = createGenerationGuard();
  let stream: MediaStream | null = null;
  let meterCtx: AudioContext | null = null;
  let raf = 0;

  function stopMeter(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    void meterCtx?.close().catch(() => undefined);
    meterCtx = null;
    if (d.meter) d.meter.style.transform = 'scaleX(0)';
  }

  function startMeter(s: MediaStream): void {
    if (!d.meter) return;
    meterCtx = createCaptureContext();
    void meterCtx.resume().catch(() => undefined);
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 1024;
    meterCtx.createMediaStreamSource(s).connect(analyser); // never connected to the speakers
    const buf = new Float32Array(analyser.fftSize);
    const bar = d.meter;
    const watch = createSilenceWatch(SILENCE_NOTICE_MS);
    const tick = (): void => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      bar.style.transform = `scaleX(${Math.min(1, rms * 4).toFixed(3)})`;
      const ev = watch(rms, performance.now());
      if (ev === 'silent') d.status('System audio: no sound detected for a few seconds (nothing playing, or another Windows output device?)');
      else if (ev === 'sound') d.status('System audio: sound detected');
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function close(): void {
    gen.next();
    d.mixer.setSystem(null);
    stopMeter();
    stopStream(stream);
    stream = null;
  }

  async function open(): Promise<void> {
    const my = gen.next();
    try {
      const host = pickAudioHostSource(d.settings.sourceId, await d.listSourceIds());
      if (!host) { d.status('System audio unavailable: no screen found'); return; }
      const s = await openSystemAudioStream(host);
      if (!gen.isCurrent(my)) { stopStream(s); return; }
      if (!s) { d.status('System audio not available on this PC'); return; }
      stream = s;
      s.getAudioTracks()[0].addEventListener('ended', () => {
        if (stream !== s) return;
        close();
        d.status('System audio stopped (audio device changed?). Toggle the option to restart it.');
      });
      d.mixer.setSystem(s);
      startMeter(s);
    } catch (e) {
      if (gen.isCurrent(my)) d.status(`System audio unavailable: ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    active: () => stream !== null,
    async sync() {
      const want = wantsSystemAudio(d.settings);
      const action = systemAudioAction(want, stream !== null, d.phase());
      if (action === 'close' || (!want && d.phase() === 'idle')) close(); // also cancels an open still in flight
      else if (action === 'open') await open();
    },
  };
}
