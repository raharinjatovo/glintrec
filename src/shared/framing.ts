import type { MobileFraming, OutputFormat } from './ipc';
import { canvasSourceSize, coverCrop, fitContain, scaleToMax, type Point, type Rect, type Size } from './overlay-layout';
import { approach } from './zoom';

/** Width / height of the mobile (portrait) output. */
export const PORTRAIT_ASPECT = 9 / 16;
/** Smoothing time constant of the cursor-following crop. */
export const FOLLOW_TAU_MS = 350;
/** Half-width of the follow dead zone, as a fraction of the crop width. */
export const FOLLOW_DEAD_ZONE = 0.2;

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SizeCap { maxWidth: number; maxHeight: number }

/** Fixed portrait canvas for a quality preset: its landscape size, swapped (720p -> 720x1280). */
export function portraitSize(preset: SizeCap): Size {
  return { width: even(preset.maxHeight), height: even(preset.maxWidth) };
}

/**
 * Output canvas size. 'pc' derives it from the source (null = source not ready yet);
 * 'mobile' is always the fixed portrait size, whatever the source.
 */
export function outputSize(
  format: OutputFormat, mode: 'screen' | 'camera', screen: Size | null, camera: Size | null, preset: SizeCap,
): Size | null {
  if (format === 'mobile') return portraitSize(preset);
  const src = canvasSourceSize(mode, screen, camera);
  return src ? scaleToMax(src, preset.maxWidth, preset.maxHeight) : null;
}

/** Horizontal crop centre (frame px) for fixed 'focus' framing. */
export function focusCenterX(frame: Size, focusX: number): number {
  return clamp(Number.isFinite(focusX) ? focusX : 0.5, 0, 1) * frame.width;
}

/**
 * Sub-rect of `view` with aspect `destAspect`, full height, centred on `centerX` (frame px) and kept
 * inside `view`. A view already narrower than the aspect is cover-cropped (full width) instead.
 */
export function framingRect(view: Rect, destAspect: number, centerX: number): Rect {
  if (!(view.width > 0) || !(view.height > 0) || !(destAspect > 0)) {
    const f = (n: number) => (Number.isFinite(n) ? n : 0);
    return { x: f(view.x), y: f(view.y), width: f(view.width), height: f(view.height) };
  }
  const w = view.height * destAspect;
  if (w >= view.width) {
    const c = coverCrop({ width: view.width, height: view.height }, { width: destAspect, height: 1 });
    return { x: view.x + c.x, y: view.y + c.y, width: c.width, height: c.height };
  }
  const cx = Number.isFinite(centerX) ? centerX : view.x + view.width / 2;
  const x = clamp(cx - w / 2, view.x, view.x + view.width - w);
  return { x, y: view.y, width: w, height: view.height };
}

export interface CameraMobileRects { src: Rect; dest: Rect; letterboxed: boolean }

/**
 * Source/dest rects for camera-only in the portrait output. 'fit' letterboxes the whole camera frame
 * (blurred backdrop behind); otherwise ('focus', and 'follow' which has no cursor for a camera) a full-height
 * canvas-aspect window is cropped at `focusX` (0..1, part of the picture AS SEEN, i.e. after mirroring).
 * `mirror` flips the final image, so the window centre in raw camera pixels is 1 - focusX.
 * `zoom` (0..1, default 1 = tight full-height crop) zooms out: the camera is drawn Wc = lerp(canvasW, canvasH*aspect, zoom)
 * wide, centred vertically; below 1 it no longer fills the canvas (letterboxed = backdrop needed). 0 = whole frame.
 */
export function cameraMobileRects(
  frame: Size, canvas: Size, framing: MobileFraming, focusX: number, mirror: boolean, zoom = 1,
): CameraMobileRects {
  const empty: Rect = { x: 0, y: 0, width: 0, height: 0 };
  if (!(frame.width > 0) || !(frame.height > 0) || !(canvas.width > 0) || !(canvas.height > 0)) {
    return { src: empty, dest: empty, letterboxed: false };
  }
  const whole: Rect = { x: 0, y: 0, width: frame.width, height: frame.height };
  if (framing === 'fit') return { src: whole, dest: fitContain(frame, canvas), letterboxed: true };
  const fx = clamp(Number.isFinite(focusX) ? focusX : 0.5, 0, 1);
  const cx = focusCenterX(frame, mirror ? 1 - fx : fx);
  const camAspect = frame.width / frame.height;
  const z = clamp(Number.isFinite(zoom) ? zoom : 1, 0, 1);
  if (z < 1 && camAspect > canvas.width / canvas.height) {
    const wc = canvas.width + (canvas.height * camAspect - canvas.width) * z;
    const hc = Math.min(canvas.height, wc / camAspect);
    const src = framingRect(whole, (frame.height > 0 ? (frame.width * canvas.width) / wc / frame.height : 1), cx);
    const dh = hc;
    return { src, dest: { x: 0, y: (canvas.height - dh) / 2, width: canvas.width, height: dh }, letterboxed: dh < canvas.height };
  }
  return {
    src: framingRect(whole, canvas.width / canvas.height, cx),
    dest: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    letterboxed: false,
  };
}

/**
 * Next crop centre for 'follow' framing: holds while the cursor stays in a dead zone around the
 * centre, otherwise eases toward the nearest dead-zone edge so the cursor stays in frame without jitter.
 */
export function followCenter(
  prevCx: number, cursorX: number | null, cropWidth: number, bounds: { min: number; max: number }, dtMs: number,
): number {
  const hold = clamp(prevCx, bounds.min, bounds.max);
  if (cursorX === null || !Number.isFinite(cursorX)) return hold;
  const dead = FOLLOW_DEAD_ZONE * cropWidth;
  const d = cursorX - prevCx;
  const target = Math.abs(d) <= dead ? prevCx : cursorX - Math.sign(d) * dead;
  return clamp(approach(prevCx, target, dtMs, FOLLOW_TAU_MS), bounds.min, bounds.max);
}

/** Whether a framing mode needs the cursor position. */
export function framingNeedsCursor(format: OutputFormat, framing: MobileFraming, mode: 'screen' | 'camera'): boolean {
  return format === 'mobile' && framing === 'follow' && mode === 'screen';
}
