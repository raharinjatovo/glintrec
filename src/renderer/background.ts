import type { BackgroundMode } from '../shared/ipc';
import { blurOverscan, effectiveBlurRadius } from '../shared/mask';
import { coverCrop, type Rect, type Size } from '../shared/overlay-layout';

export interface BackgroundSpec {
  mode: BackgroundMode;
  color: string;
  blurRadius: number;
  image: ImageBitmap | null;
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export async function loadBackgroundImage(path: string): Promise<ImageBitmap> {
  const { mime, bytes } = await window.recorderApi.loadImage(path);
  return createImageBitmap(new Blob([bytes], { type: mime }));
}

/** Draws the replacement background for the overlay (blur / color / image). Not used for mode 'none'. */
export function drawBackground(
  ctx: Ctx, cam: CanvasImageSource, camSize: Size, dest: Size, spec: BackgroundSpec, src?: Rect,
): void {
  if (spec.mode === 'color') {
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, dest.width, dest.height);
    return;
  }
  if (spec.mode === 'image' && spec.image) {
    const s = coverCrop({ width: spec.image.width, height: spec.image.height }, dest);
    ctx.drawImage(spec.image, s.x, s.y, s.width, s.height, 0, 0, dest.width, dest.height);
    return;
  }
  if (spec.mode === 'blur') {
    // Overscan: draw larger than the frame so the blur's transparent fringe is never visible.
    const m = blurOverscan(spec.blurRadius);
    const s = src ?? coverCrop(camSize, dest);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, dest.width, dest.height);
    ctx.filter = `blur(${effectiveBlurRadius(spec.blurRadius)}px)`;
    ctx.drawImage(cam, s.x, s.y, s.width, s.height, -m, -m, dest.width + 2 * m, dest.height + 2 * m);
    ctx.filter = 'none';
    return;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, dest.width, dest.height);
}
