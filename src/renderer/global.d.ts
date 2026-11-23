import type { RecorderApi } from '../shared/ipc';

declare global {
  interface Window {
    recorderApi: RecorderApi;
    /** Only present in the draw overlay page (annotate-preload). */
    setAnnotationNotice?: (msg: string | null) => void;
    /** Main asks the overlay page to send its bar state again (e.g. when drawing resumes). */
    resendBar?: () => void;
    annotationApi?: {
      sendStroke(stroke: unknown): void; sendClear(): void; sendBar(bar: unknown): void;
      sendControl(cmd: 'pause-toggle' | 'switch-mode' | 'stop'): void;
      onControlView(cb: (v: { paused: boolean; pauseLabel: string; modeLabel: string; stopLabel: string; canSwitch: boolean } | null) => void): void;
    };
  }
}
export {};
