import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blendConfidence, blurOverscan, effectiveBlurRadius, featherRadius, MASK_HI, MASK_LO, maskAlpha, smoothstep,
} from '../src/shared/mask';

describe('mask alpha curve', () => {
  it('is exactly 0 for background-ish confidence and 1 for person', () => {
    expect(maskAlpha(0)).toBe(0);
    expect(maskAlpha(0.3)).toBe(0);
    expect(maskAlpha(MASK_LO)).toBe(0);
    expect(maskAlpha(MASK_HI)).toBe(1);
    expect(maskAlpha(1)).toBe(1);
  });
  it('is monotonic and tighter than the old (v-0.3)/0.4 ramp', () => {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.01) {
      const a = maskAlpha(v);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(maskAlpha(0.4)).toBeLessThan((0.4 - 0.3) / 0.4);
    expect(MASK_HI - MASK_LO).toBeLessThan(0.4);
  });
  it('smoothstep clamps and is symmetric at the midpoint', () => {
    expect(smoothstep(0, 1, -5)).toBe(0);
    expect(smoothstep(0, 1, 5)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe('temporal blend', () => {
  it('averages small changes', () => {
    const v = blendConfidence(0.5, 0.52);
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(0.52);
  });
  it('snaps to the new frame on large changes (no ghost trail)', () => {
    expect(blendConfidence(1, 0)).toBe(0);
    expect(blendConfidence(0, 1)).toBe(1);
    expect(blendConfidence(0.9, 0.2)).toBeCloseTo(0.2);
  });
  it('never leaves [prev,next]', () => {
    for (const [p, n] of [[0.1, 0.4], [0.8, 0.6], [0.5, 0.5]]) {
      const v = blendConfidence(p, n);
      expect(v).toBeGreaterThanOrEqual(Math.min(p, n) - 1e-9);
      expect(v).toBeLessThanOrEqual(Math.max(p, n) + 1e-9);
    }
  });
});

describe('blur helpers', () => {
  it('raises too-low and clamps too-high radii, tolerates NaN', () => {
    expect(effectiveBlurRadius(2)).toBe(8);
    expect(effectiveBlurRadius(12)).toBe(12);
    expect(effectiveBlurRadius(500)).toBe(60);
    expect(effectiveBlurRadius(NaN)).toBe(8);
  });
  it('overscan covers the blur fringe', () => {
    expect(blurOverscan(12)).toBeGreaterThanOrEqual(24);
    expect(blurOverscan(1)).toBe(16);
  });
  it('feather radius scales with upscale factor within 1..3px', () => {
    expect(featherRadius(256, 256)).toBe(1);
    expect(featherRadius(1280, 256)).toBe(2);
    expect(featherRadius(8000, 256)).toBe(3);
    expect(featherRadius(0, 0)).toBe(1);
  });
});

const handlers = new Map<string, (...a: any[]) => Promise<any>>();
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\Users\WINDOWS 10\Videos' },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: { handle: (ch: string, fn: (...a: any[]) => Promise<any>) => handlers.set(ch, fn) },
}));

describe('floating overlay background config', () => {
  beforeEach(() => handlers.clear());
  it('sanitizes background and drops non-whitelisted image paths', async () => {
    const { registerIpc } = await import('../src/main/ipc-handlers');
    const { IPC } = await import('../src/shared/ipc');
    const wc = {};
    const shown: any[] = [];
    const allowed = new Set<string>(['C:\ok.png']);
    registerIpc({
      getWindow: () => ({ webContents: wc }) as any, settings: {} as any, writers: {} as any,
      allowedImagePaths: allowed, overlay: { show: (c: any) => shown.push(c), update: (c: any) => shown.push(c) } as any,
    });
    const call = (raw: unknown) => handlers.get(IPC.overlayShow)!({ sender: wc }, raw);
    await call({ shape: 'circle', background: { mode: 'image', imagePath: 'C:\evil.png', blurRadius: 9999, color: 'red' } });
    expect(shown[0].background).toMatchObject({ mode: 'image', imagePath: null, blurRadius: 40, color: '#1e90ff' });
    await call({ background: { mode: 'blur', imagePath: 'C:\ok.png' } });
    expect(shown[1].background.imagePath).toBe('C:\ok.png');
    await call({});
    expect(shown[2].background.mode).toBe('none');
  });
});
