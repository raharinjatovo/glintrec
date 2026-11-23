/**
 * Screen capture goes through getDisplayMedia: the main process answers it with the source
 * announced by selectCaptureSource (see setDisplayMediaRequestHandler in main.ts).
 */
export async function openScreenStream(sourceId: string, fps = 30): Promise<MediaStream> {
  await window.recorderApi.selectCaptureSource(sourceId);
  return navigator.mediaDevices.getDisplayMedia({
    audio: false, // PC sound has its own capture (system-audio.ts) so it survives camera <-> screen switches
    video: { frameRate: { ideal: fps, max: fps } },
  });
}

/** Off-screen <video> that feeds a MediaStream into the compositor. */
export function hiddenVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.autoplay = true;
  v.playsInline = true;
  v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none';
  document.body.appendChild(v);
  return v;
}

export function stopStream(s: MediaStream | null): void {
  s?.getTracks().forEach((t) => t.stop());
}

/**
 * System audio only (Windows loopback = everything the PC plays; processing off so music/voices are not
 * ducked or gated). getDisplayMedia needs a video source, so the video track is stopped at once and only
 * the audio track is kept. Null when no audio came back.
 */
export async function openSystemAudioStream(hostSourceId: string): Promise<MediaStream | null> {
  await window.recorderApi.selectCaptureSource(hostSourceId);
  const s = await navigator.mediaDevices.getDisplayMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: { frameRate: { ideal: 1, max: 1 } },
  });
  s.getVideoTracks().forEach((t) => t.stop());
  const audio = s.getAudioTracks();
  if (audio.length === 0) { stopStream(s); return null; }
  return new MediaStream(audio);
}
