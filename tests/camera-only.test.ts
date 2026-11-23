import { describe, expect, it } from 'vitest';
import { canvasSourceSize, DEFAULT_CANVAS_SIZE } from '../src/shared/overlay-layout';

const screen = { width: 1920, height: 1080 };
const cam = { width: 640, height: 480 };

describe('canvasSourceSize', () => {
  it('uses the screen in screen mode', () => {
    expect(canvasSourceSize('screen', screen, cam)).toEqual(screen);
  });
  it('returns null in screen mode until the screen is ready', () => {
    expect(canvasSourceSize('screen', null, cam)).toBeNull();
    expect(canvasSourceSize('screen', { width: 0, height: 0 }, cam)).toBeNull();
  });
  it('uses the camera in camera mode, ignoring the screen', () => {
    expect(canvasSourceSize('camera', screen, cam)).toEqual(cam);
  });
  it('falls back to 1280x720 before the camera is ready', () => {
    expect(canvasSourceSize('camera', screen, null)).toEqual(DEFAULT_CANVAS_SIZE);
    expect(canvasSourceSize('camera', null, { width: 0, height: 0 })).toEqual({ width: 1280, height: 720 });
  });
});
