// Source the user picked in the UI; consumed by the session's display-media request handler.
const SOURCE_ID = /^(screen|window):\d+:\d+$/;

let selected: string | null = null;

export function isValidSourceId(id: unknown): id is string {
  return typeof id === 'string' && SOURCE_ID.test(id);
}

export function setSelectedSource(id: unknown): void {
  if (!isValidSourceId(id)) throw new Error('Invalid capture source id');
  selected = id;
}

export function getSelectedSource(): string | null {
  return selected;
}

/**
 * Answer to a getDisplayMedia request: the selected video source, plus Windows system-audio loopback
 * (not muted locally) only when the page asked for audio. No video source -> deny everything.
 */
export function buildDisplayMediaResponse<V>(
  video: V | undefined, audioRequested: boolean,
): { video: V; audio?: 'loopback' } | Record<string, never> {
  if (!video) return {};
  return audioRequested ? { video, audio: 'loopback' } : { video };
}
