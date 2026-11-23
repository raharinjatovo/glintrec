export interface DeviceLists { cameras: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }

async function tryPrime(constraints: MediaStreamConstraints): Promise<void> {
  try {
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    s.getTracks().forEach((t) => t.stop());
  } catch {
    /* NotAllowed / NotFound: ignore, device lists will simply lack labels */
  }
}

/** Request permissions so enumerateDevices returns labels. Video and audio tried independently. */
export async function primeDevicePermissions(): Promise<void> {
  await tryPrime({ video: true });
  await tryPrime({ audio: true });
}

export async function listDevices(): Promise<DeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: all.filter((d) => d.kind === 'videoinput'),
    mics: all.filter((d) => d.kind === 'audioinput'),
  };
}

/** `hd`: ask for 1080p (portrait crops of the camera keep more detail). */
export function openCamera(deviceId: string | null, hd = false): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: hd ? 1920 : 1280 },
      height: { ideal: hd ? 1080 : 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
}

/** `processing` toggles noise suppression, echo cancellation and auto gain together. */
export function openMic(deviceId: string | null, processing = true): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: processing,
    },
    video: false,
  });
}
