import { blendConfidence, featherRadius, maskAlpha } from '../shared/mask';
import { coverCrop, type Rect, type Size } from '../shared/overlay-layout';
import { drawBackground, type BackgroundSpec } from './background';
import type { PersonMask, Segmenter } from './segmenter';

type C2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
}

/** Shared by the recording compositor and the floating bubble: segmentation cadence, mask, background + person. */
export interface PersonComposer {
  reset(): void;
  /** Runs the segmenter every 2nd (3rd when slow) call and refreshes the mask. */
  segment(segmenter: Segmenter | null, cam: HTMLVideoElement): void;
  /** Draws background + masked person into ctx (dest-sized). Returns false if nothing was drawn (no mask / mode none). */
  compose(ctx: C2D, cam: HTMLVideoElement, dest: Size, spec: BackgroundSpec, segmenterActive: boolean, src?: Rect): boolean;
}

export function createPersonComposer(): PersonComposer {
  let personCv = makeCanvas(2, 2);
  let maskCv = makeCanvas(2, 2);
  let smooth: Float32Array | null = null;
  let hasMask = false;
  let calls = 0;
  let segEvery = 2;

  function updateMask(mask: PersonMask): void {
    const n = mask.data.length;
    if (!smooth || smooth.length !== n) {
      smooth = new Float32Array(n);
      smooth.set(mask.data);
    } else {
      for (let i = 0; i < n; i++) smooth[i] = blendConfidence(smooth[i], mask.data[i]);
    }
    if (maskCv.width !== mask.width || maskCv.height !== mask.height) maskCv = makeCanvas(mask.width, mask.height);
    const mctx = maskCv.getContext('2d')! as C2D;
    const img = mctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < n; i++) img.data[i * 4 + 3] = maskAlpha(smooth[i]) * 255;
    mctx.putImageData(img, 0, 0);
    hasMask = true;
  }

  return {
    reset() { hasMask = false; smooth = null; },
    segment(segmenter, cam) {
      if (!segmenter) return;
      if (calls++ % segEvery !== 0) return;
      const t0 = performance.now();
      const mask = segmenter.segment(cam, t0);
      if (mask) updateMask(mask);
      segEvery = performance.now() - t0 > 40 ? 3 : 2;
    },
    compose(ctx, cam, dest, spec, segmenterActive, src) {
      const camSize: Size = { width: cam.videoWidth, height: cam.videoHeight };
      if (spec.mode === 'none' || !segmenterActive || !hasMask || camSize.width === 0) return false;
      drawBackground(ctx, cam, camSize, dest, spec, src);

      if (personCv.width !== camSize.width || personCv.height !== camSize.height) {
        personCv = makeCanvas(camSize.width, camSize.height);
      }
      const pctx = personCv.getContext('2d')! as C2D;
      pctx.globalCompositeOperation = 'source-over';
      pctx.clearRect(0, 0, camSize.width, camSize.height);
      pctx.drawImage(cam, 0, 0);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.imageSmoothingEnabled = true;
      pctx.imageSmoothingQuality = 'high';
      // Feather the upscaled mask a little; overscan keeps the blur's transparent fringe off the frame edges.
      const f = featherRadius(camSize.width, maskCv.width);
      const o = Math.ceil(f * 2);
      pctx.filter = `blur(${f}px)`;
      pctx.drawImage(maskCv, -o, -o, camSize.width + 2 * o, camSize.height + 2 * o);
      pctx.filter = 'none';
      pctx.globalCompositeOperation = 'source-over';

      const s = src ?? coverCrop(camSize, dest);
      ctx.drawImage(personCv, s.x, s.y, s.width, s.height, 0, 0, dest.width, dest.height);
      return true;
    },
  };
}
