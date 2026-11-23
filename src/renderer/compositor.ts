import type { MobileSettings, OutputFormat, Settings } from '../shared/ipc';
import { cameraMobileRects, focusCenterX, followCenter, framingRect, outputSize, PORTRAIT_ASPECT } from '../shared/framing';
import {
  coverCrop, fitContain, overlayRectFor, ROUNDED_RADIUS_RATIO, type Rect, type Size,
} from '../shared/overlay-layout';
import type { BackgroundSpec } from './background';
import { createPersonComposer } from './person-compose';
import type { AnnotationLayer } from './annotation-layer';
import type { EffectsLayer } from './effects';
import type { Segmenter } from './segmenter';
import {
  bubbleRadius, detectModeChange, morphFrame, transitionDone, transitionProgress, type ModeTransition,
} from '../shared/mode-transition';
import { regionFromView, sameRegion, type CaptureRegion } from '../shared/capture-region';

export interface CompositorOptions {
  canvas: HTMLCanvasElement;
  fps: number;
  maxWidth: number;
  maxHeight: number;
}
export interface CompositorState {
  captureMode: Settings['captureMode'];
  outputFormat: OutputFormat;
  mobile: MobileSettings;
  cameraEnabled: boolean;
  overlay: Settings['overlay'];
  background: BackgroundSpec;
}
export interface Compositor {
  setScreen(video: HTMLVideoElement | null): void;
  setCamera(video: HTMLVideoElement | null, segmenter: Segmenter | null): void;
  /** Cursor/click/key effects and auto-zoom, drawn on screen frames only (null = none). */
  setEffects(layer: EffectsLayer | null): void;
  /** Pen strokes from the draw overlay, drawn on screen frames only (null = none). */
  setAnnotations(layer: AnnotationLayer | null): void;
  update(state: CompositorState): void;
  lockSize(locked: boolean): void;
  /** Output size cap and frame rate (quality preset). Takes effect for the next captureStream(). */
  setQuality(q: { maxWidth: number; maxHeight: number; fps: number }): void;
  /** PNG of the current composited frame (what the recording contains). */
  snapshot(): Promise<Blob | null>;
  /** Called when the part of the screen the video shows changes (null = whole screen / not a screen view). Throttled. */
  setRegionListener(cb: ((r: CaptureRegion | null) => void) | null): void;
  start(): void;
  stop(): void;
  captureStream(): MediaStream;
}

type C2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
}

export function createCompositor(opts: CompositorOptions): Compositor {
  const { canvas } = opts;
  let fps = opts.fps;
  let maxWidth = opts.maxWidth;
  let maxHeight = opts.maxHeight;
  const mainCtx = canvas.getContext('2d', { alpha: false })!;
  // Drawing target of the helpers below: the main canvas, or the incoming layer during a mode transition.
  let ctx: CanvasRenderingContext2D = mainCtx;
  let layerCv: HTMLCanvasElement | null = null;
  let prevMode: Settings['captureMode'] | null = null;
  let prevW = 0;
  let prevH = 0;
  let transition: ModeTransition | null = null;
  let stream: MediaStream | null = null;
  let streamFps = 0;
  canvas.width = 1280;
  canvas.height = 720;

  let screen: HTMLVideoElement | null = null;
  let camera: HTMLVideoElement | null = null;
  let segmenter: Segmenter | null = null;
  let state: CompositorState | null = null;
  let effects: EffectsLayer | null = null;
  let annotations: AnnotationLayer | null = null;
  let locked = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let nextAt = 0;

  let followCx = 0;
  let followFrameW = 0;
  let lastFollowAt = 0;
  let backdropCv: OffscreenCanvas | null = null;

  let overlayCv = makeCanvas(2, 2);
  const person = createPersonComposer();

  function syncCanvasSize(): void {
    if (locked) return;
    const vs = (v: HTMLVideoElement | null): Size | null => (v ? { width: v.videoWidth, height: v.videoHeight } : null);
    const s = outputSize(state?.outputFormat ?? 'pc', state?.captureMode ?? 'screen', vs(screen), vs(camera), { maxWidth, maxHeight });
    if (!s) return;
    if (canvas.width !== s.width || canvas.height !== s.height) {
      canvas.width = s.width;
      canvas.height = s.height;
    }
  }

  function composeOverlay(cam: HTMLVideoElement, rw: number, rh: number, st: CompositorState, src?: Rect): void {
    if (overlayCv.width !== rw || overlayCv.height !== rh) overlayCv = makeCanvas(rw, rh);
    const octx = overlayCv.getContext('2d')! as C2D;
    const dest: Size = { width: rw, height: rh };
    if (person.compose(octx, cam, dest, st.background, segmenter !== null, src)) return;
    const s = src ?? coverCrop({ width: cam.videoWidth, height: cam.videoHeight }, dest);
    octx.drawImage(cam, s.x, s.y, s.width, s.height, 0, 0, rw, rh);
  }

  function clipPath(c: C2D, w: number, h: number, shape: Settings['overlay']['shape']): void {
    c.beginPath();
    if (shape === 'circle') {
      c.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    } else {
      c.roundRect(0, 0, w, h, Math.min(w, h) * ROUNDED_RADIUS_RATIO);
    }
  }

  function drawOverlay(cam: HTMLVideoElement, st: CompositorState): void {
    const rect = overlayRectFor({ width: canvas.width, height: canvas.height }, st.overlay);
    person.segment(segmenter, cam);
    composeOverlay(cam, rect.width, rect.height, st);

    // Mirror (selfie view) once, after all composition.
    ctx.save();
    if (st.overlay.mirror) {
      ctx.translate(rect.x + rect.width, rect.y);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(rect.x, rect.y);
    }
    clipPath(ctx, rect.width, rect.height, st.overlay.shape);
    ctx.save();
    ctx.clip();
    ctx.drawImage(overlayCv, 0, 0);
    ctx.restore();
    // The border is drawn inside the bubble's rect, so overlayRectFor / hit-testing stay exact.
    const b = st.overlay.border;
    if (b.enabled && b.width > 0) {
      const bw = Math.min(b.width, Math.min(rect.width, rect.height) / 4);
      ctx.translate(bw / 2, bw / 2);
      clipPath(ctx, rect.width - bw, rect.height - bw, st.overlay.shape);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = bw;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Camera-only: camera fills the whole canvas (mirrored unless turned off, no clip/border), background effects intact.
  function drawFullCamera(cam: HTMLVideoElement, st: CompositorState): void {
    person.segment(segmenter, cam);
    if (st.outputFormat === 'mobile') { drawMobileCamera(cam, st); return; }
    composeOverlay(cam, canvas.width, canvas.height, st);
    ctx.save();
    if (st.overlay.mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(overlayCv, 0, 0);
    ctx.restore();
  }

  // Camera-only portrait: a focus-point crop of the camera, or the whole frame letterboxed over a blurred backdrop.
  function drawMobileCamera(cam: HTMLVideoElement, st: CompositorState): void {
    const frame: Size = { width: cam.videoWidth, height: cam.videoHeight };
    const r = cameraMobileRects(frame, canvas, st.mobile.framing, st.mobile.focusX, st.overlay.mirror, st.mobile.cameraZoom);
    if (r.dest.width <= 0) return;
    composeOverlay(cam, Math.round(r.dest.width), Math.round(r.dest.height), st, r.src);
    ctx.save();
    if (st.overlay.mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    if (r.letterboxed) drawBackdrop(cam);
    ctx.drawImage(overlayCv, r.dest.x, r.dest.y, r.dest.width, r.dest.height);
    ctx.restore();
  }

  /** 'pc' (and mobile 'fit' on top of its backdrop): the whole frame letterboxed into the canvas. */
  const REGION_MIN_GAP_MS = 40;
  let regionCb: ((r: CaptureRegion | null) => void) | null = null;
  let lastRegion: CaptureRegion | null = null;
  let lastRegionAt = 0;
  function reportRegion(view: Rect | null | undefined, frame: Size | null, now: number): void {
    if (!regionCb) return;
    const r = view && frame ? regionFromView(view, frame) : null;
    if (sameRegion(r, lastRegion)) return;
    if (r && lastRegion && now - lastRegionAt < REGION_MIN_GAP_MS) return;
    lastRegion = r;
    lastRegionAt = now;
    regionCb(r);
  }

  function drawScreenFitted(src: HTMLVideoElement, frame: Size, now: number): void {
    const r = fitContain(frame, canvas);
    const view = effects?.beginFrame(now, frame);
    reportRegion(view, frame, now);
    if (view) ctx.drawImage(src, view.x, view.y, view.width, view.height, r.x, r.y, r.width, r.height);
    else ctx.drawImage(src, r.x, r.y, r.width, r.height);
    // Strokes go through the same zoom view as the frame (so auto-zoom keeps them aligned), under ripples/halo.
    annotations?.draw(ctx, view ?? { x: 0, y: 0, width: frame.width, height: frame.height }, r, frame);
    if (view) effects?.drawWorld(ctx, view, r, frame, now);
  }

  /** Cheap blurred backdrop: the frame shrunk to a tiny canvas and stretched back with smoothing. */
  function drawBackdrop(src: HTMLVideoElement): void {
    backdropCv ??= makeCanvas(36, 64);
    const b = backdropCv.getContext('2d')! as C2D;
    const c = coverCrop({ width: src.videoWidth, height: src.videoHeight }, { width: 36, height: 64 });
    b.drawImage(src, c.x, c.y, c.width, c.height, 0, 0, 36, 64);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(backdropCv, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawMobileScreen(src: HTMLVideoElement, frame: Size, st: CompositorState, now: number): void {
    const framing = st.mobile.framing;
    if (framing === 'fit') {
      drawBackdrop(src);
      drawScreenFitted(src, frame, now);
      return;
    }
    const full: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
    const view0 = effects?.beginFrame(now, frame) ?? { x: 0, y: 0, width: frame.width, height: frame.height };
    const aspect = canvas.width / canvas.height || PORTRAIT_ASPECT;
    const cropW = Math.min(view0.width, view0.height * aspect);
    if (followFrameW !== frame.width) { followFrameW = frame.width; followCx = frame.width / 2; lastFollowAt = 0; }
    const cursor = framing === 'follow' ? effects?.cursorFramePoint(frame) ?? null : null;
    let cx: number;
    if (cursor) {
      const dt = lastFollowAt > 0 ? Math.min(250, now - lastFollowAt) : 0;
      lastFollowAt = now;
      followCx = followCenter(followCx, cursor.x, cropW, { min: view0.x + cropW / 2, max: view0.x + view0.width - cropW / 2 }, dt);
      cx = followCx;
    } else if (framing === 'follow') {
      cx = followCx; // no usable cursor sample: hold the last crop position instead of jumping to the focus slider
    } else {
      // Follow with no usable cursor holds the last crop centre instead of jumping to the focus point.
      cx = st.mobile.framing === 'follow' ? followCx : focusCenterX(frame, st.mobile.focusX);
    }
    const crop = framingRect(view0, aspect, cx);
    reportRegion(crop, frame, now);
    ctx.drawImage(src, crop.x, crop.y, crop.width, crop.height, full.x, full.y, full.width, full.height);
    annotations?.draw(ctx, crop, full, frame);
    effects?.drawWorld(ctx, crop, full, frame, now);
  }

  function drawComposition(mode: Settings['captureMode'], st: CompositorState | null, withBubble = true): void {
    if (mode === 'camera') {
      reportRegion(null, null, performance.now());
      if (st && camera && camera.readyState >= 2 && camera.videoWidth > 0) drawFullCamera(camera, st);
      return;
    }
    const now = performance.now();
    if (screen && screen.readyState >= 2 && screen.videoWidth > 0) {
      const frame = { width: screen.videoWidth, height: screen.videoHeight };
      if (st?.outputFormat === 'mobile') drawMobileScreen(screen, frame, st, now);
      else drawScreenFitted(screen, frame, now);
    } else {
      reportRegion(null, null, now);
    }
    if (withBubble && st?.cameraEnabled && camera && camera.readyState >= 2 && camera.videoWidth > 0) {
      drawOverlay(camera, st);
    }
    effects?.drawOverlay(ctx, canvas, now);
  }

  function clearTarget(c: CanvasRenderingContext2D): void {
    c.fillStyle = '#000';
    c.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Shared-element transition: the camera shrinks from full canvas into the bubble rect (camera-only ->
   * screen) or grows from it (screen -> camera-only), while the screen layer (without bubble) fades/scales in or out.
   */
  function drawTransition(t: ModeTransition, st: CompositorState | null, progress: number): void {
    const toScreen = t.to === 'screen';
    const canvasSize: Size = { width: canvas.width, height: canvas.height };
    const hasBubble = !!st?.cameraEnabled;
    const bubble = st ? overlayRectFor(canvasSize, st.overlay) : { x: 0, y: 0, width: canvas.width, height: canvas.height };
    const f = morphFrame(progress, toScreen, canvasSize, hasBubble ? bubble : { x: 0, y: 0, width: canvas.width, height: canvas.height },
      st && hasBubble ? bubbleRadius(st.overlay.shape, bubble) : 0);

    // Camera-only composition (mirror, segmentation, mobile framing) rendered to a full-canvas layer.
    if (!layerCv) layerCv = document.createElement('canvas');
    if (layerCv.width !== canvas.width || layerCv.height !== canvas.height) {
      layerCv.width = canvas.width;
      layerCv.height = canvas.height;
    }
    const layerCtx = layerCv.getContext('2d')!;
    ctx = layerCtx;
    clearTarget(layerCtx);
    drawComposition('camera', st);

    // Screen layer behind, without the bubble (the morphing camera plays that part).
    ctx = mainCtx;
    clearTarget(mainCtx);
    mainCtx.save();
    mainCtx.globalAlpha = f.screenAlpha;
    mainCtx.translate(canvas.width / 2, canvas.height / 2);
    mainCtx.scale(f.screenScale, f.screenScale);
    mainCtx.translate(-canvas.width / 2, -canvas.height / 2);
    drawComposition('screen', st, false);
    mainCtx.restore();

    // Morphing camera. Without a bubble in screen mode the camera simply fades out/in at full size.
    mainCtx.save();
    if (!hasBubble) mainCtx.globalAlpha = 1 - f.t;
    if (hasBubble) {
      mainCtx.beginPath();
      mainCtx.roundRect(f.rect.x, f.rect.y, f.rect.width, f.rect.height, f.radius);
      mainCtx.clip();
    }
    mainCtx.drawImage(layerCv, f.src.x, f.src.y, f.src.width, f.src.height, f.rect.x, f.rect.y, f.rect.width, f.rect.height);
    mainCtx.restore();

    const b = st?.overlay.border;
    if (st && hasBubble && b && b.enabled && b.width > 0 && f.borderAlpha > 0) {
      const bw = Math.min(b.width, Math.min(f.rect.width, f.rect.height) / 4);
      mainCtx.save();
      mainCtx.globalAlpha = f.borderAlpha;
      mainCtx.beginPath();
      mainCtx.roundRect(f.rect.x + bw / 2, f.rect.y + bw / 2, f.rect.width - bw, f.rect.height - bw, Math.max(0, f.radius - bw / 2));
      mainCtx.strokeStyle = b.color;
      mainCtx.lineWidth = bw;
      mainCtx.stroke();
      mainCtx.restore();
    }
  }

  function draw(): void {
    syncCanvasSize();
    ctx = mainCtx;
    const mode = state?.captureMode ?? 'screen';
    const sameSize = canvas.width === prevW && canvas.height === prevH;
    if (detectModeChange(prevMode, mode, sameSize)) {
      transition = { from: prevMode!, to: mode, startedAt: performance.now() };
    }
    prevMode = mode;
    prevW = canvas.width;
    prevH = canvas.height;
    if (transition) {
      const now = performance.now();
      if (transition.to !== mode || !sameSize || transitionDone(transition.startedAt, now)) {
        transition = null;
      } else {
        drawTransition(transition, state, transitionProgress(transition.startedAt, now));
        return;
      }
    }
    clearTarget(mainCtx);
    drawComposition(mode, state);
  }

  function tick(): void {
    if (!running) return;
    try {
      draw();
    } catch (e) {
      console.error('compositor draw failed', e);
    }
    const interval = 1000 / fps;
    nextAt += interval;
    const now = performance.now();
    if (nextAt < now - interval * 3) nextAt = now; // fell far behind: resync
    timer = setTimeout(tick, Math.max(0, nextAt - now));
  }

  return {
    setScreen(v) { screen = v; },
    setCamera(v, s) {
      camera = v;
      segmenter = s;
      person.reset();
    },
    setEffects(layer) { effects = layer; },
    setAnnotations(layer) { annotations = layer; },
    setRegionListener(cb) { regionCb = cb; lastRegion = null; lastRegionAt = 0; },
    update(s) { state = s; },
    lockSize(l) { locked = l; },
    setQuality(q) { fps = q.fps; maxWidth = q.maxWidth; maxHeight = q.maxHeight; },
    snapshot() { return new Promise((resolve) => canvas.toBlob(resolve, 'image/png')); },
    start() {
      if (running) return;
      running = true;
      prevMode = null;
      transition = null;
      followFrameW = 0;
      lastRegion = null;
      lastRegionAt = 0;
      nextAt = performance.now();
      tick();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    captureStream() {
      // One stream per frame rate; a stale one (previous preset) is released first.
      if (!stream || streamFps !== fps) {
        stream?.getTracks().forEach((t) => t.stop());
        stream = canvas.captureStream(fps);
        streamFps = fps;
      }
      return stream;
    },
  };
}
