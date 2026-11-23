import type { BackgroundMode } from '../shared/ipc';
import { coverCrop } from '../shared/overlay-layout';
import type { BackgroundSpec } from './background';
import { openCamera } from './devices';
import { createPersonComposer } from './person-compose';
import { createSegmenter, type Segmenter } from './segmenter';

// Live camera preview inside the floating bubble; the main process passes the device id as ?cam=.
// With a background mode other than 'none' the frames go through the same segmenter + compositing as the recording.
const cam = document.getElementById('cam') as HTMLVideoElement;
const out = document.getElementById('out') as HTMLCanvasElement;
const ctx = out.getContext('2d')!;
const params = new URLSearchParams(location.search);
const id = params.get('cam');
document.body.dataset.shape = params.get('shape') === 'rounded' ? 'rounded' : 'circle';

const MAX_BUBBLE_PX = 480;
const FRAME_MS = 33;
const person = createPersonComposer();
let spec: BackgroundSpec = { mode: 'none', color: '#1e90ff', blurRadius: 12, image: null };
let segmenter: Segmenter | null = null;
let segLoading = false;
let raf = 0;
let lastFrame = 0;

async function ensureSegmenter(): Promise<void> {
  if (segmenter || segLoading) return;
  segLoading = true;
  try {
    segmenter = await createSegmenter();
    person.reset();
  } catch (e) {
    console.warn('bubble segmenter unavailable, showing raw camera', e);
  } finally {
    segLoading = false;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function decodeImage(img: { mime: string; b64: string } | null): Promise<ImageBitmap | null> {
  if (!img) return null;
  try {
    return await createImageBitmap(new Blob([b64ToBytes(img.b64) as BlobPart], { type: img.mime }));
  } catch { return null; }
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  if (spec.mode === 'none' || now - lastFrame < FRAME_MS) return;
  if (cam.readyState < 2 || cam.videoWidth === 0) return;
  lastFrame = now;
  const k = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.min(MAX_BUBBLE_PX, Math.max(2, Math.round(out.clientWidth * k)));
  const h = Math.min(MAX_BUBBLE_PX, Math.max(2, Math.round(out.clientHeight * k)));
  if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
  person.segment(segmenter, cam);
  const dest = { width: w, height: h };
  if (!person.compose(ctx, cam, dest, spec, segmenter !== null)) {
    const s = coverCrop({ width: cam.videoWidth, height: cam.videoHeight }, dest);
    ctx.drawImage(cam, s.x, s.y, s.width, s.height, 0, 0, w, h);
  }
}

/** Called by the main process (executeJavaScript) whenever the background choice changes. */
(window as unknown as {
  __setBackground: (s: { mode: BackgroundMode; color: string; blurRadius: number }, img: { mime: string; b64: string } | null) => void;
}).__setBackground = (s, img) => {
  void decodeImage(img).then((bitmap) => {
    spec.image?.close();
    spec = { mode: s.mode, color: s.color, blurRadius: s.blurRadius, image: s.mode === 'image' ? bitmap : null };
    if (s.mode !== 'image') bitmap?.close();
    document.body.dataset.bg = s.mode === 'none' ? 'off' : 'on';
    if (s.mode !== 'none') void ensureSegmenter();
    if (!raf) raf = requestAnimationFrame(frame);
  });
};

window.addEventListener('pagehide', () => {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  segmenter?.close();
  segmenter = null;
  (cam.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
});
openCamera(id || null)
  .catch(() => openCamera(null))
  .then((stream) => { cam.srcObject = stream; })
  .catch(() => undefined);
