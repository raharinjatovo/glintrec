import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

export interface PersonMask { width: number; height: number; data: Float32Array }
export interface Segmenter {
  segment(video: HTMLVideoElement, tsMs: number): PersonMask | null;
  close(): void;
}

const WASM_URL = 'app://local/assets/mediapipe/wasm';
const MODEL_URL = 'app://local/assets/mediapipe/selfie_segmenter.tflite';

async function create(delegate: 'GPU' | 'CPU'): Promise<ImageSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  return ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

export async function createSegmenter(): Promise<Segmenter> {
  let seg: ImageSegmenter;
  try {
    seg = await create('GPU');
  } catch (e) {
    console.warn('GPU segmenter failed, falling back to CPU', e);
    seg = await create('CPU');
  }
  let lastTs = -1;
  let buf: Float32Array | null = null;
  let loggedCount = false;

  return {
    segment(video, tsMs) {
      if (video.readyState < 2 || tsMs <= lastTs) return null;
      lastTs = tsMs;
      let out: PersonMask | null = null;
      seg.segmentForVideo(video, tsMs, (result) => {
        const masks = result.confidenceMasks;
        if (!masks || masks.length === 0) return;
        if (!loggedCount) {
          loggedCount = true;
          console.info(`segmenter: ${masks.length} confidence mask(s)`);
        }
        const mask = masks.length === 1 ? masks[0] : masks[1];
        const data = mask.getAsFloat32Array();
        if (!buf || buf.length !== data.length) buf = new Float32Array(data.length);
        buf.set(data);
        out = { width: mask.width, height: mask.height, data: buf };
        masks.forEach((m) => m.close());
      });
      return out;
    },
    close() {
      seg.close();
    },
  };
}
