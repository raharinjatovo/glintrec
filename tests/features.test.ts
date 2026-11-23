import { EventEmitter } from 'node:events';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildGifArgs, buildGifPaletteArgs, convertToGif, GIF_MAX_FPS, GIF_MAX_WIDTH,
} from '../src/main/ffmpeg';
import { createHotkeyManager } from '../src/main/hotkeys';
import { isPng, toPngBytes, writeScreenshot } from '../src/main/screenshot';
import { screenshotName } from '../src/shared/format';
import { DEFAULT_HOTKEYS, findHotkeyConflict, sanitizeHotkeys, validateAccelerator } from '../src/shared/hotkeys';
import { QUALITY_PRESETS, qualityPreset } from '../src/shared/quality';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';

describe('validateAccelerator', () => {
  it.each([
    ['CommandOrControl+Shift+R', 'CommandOrControl+Shift+R'],
    ['ctrl+shift+r', 'Control+Shift+R'],
    ['Shift + Ctrl + r', 'Control+Shift+R'],
    ['Alt+F4', 'Alt+F4'],
    ['f12', 'F12'],
    ['Ctrl+Plus', 'Control+Plus'],
    ['Ctrl+Alt+PageDown', 'Control+Alt+PageDown'],
    ['Super+num5', 'Super+num5'],
    ['Ctrl+,', 'Control+,'],
  ])('accepts %s', (input, canon) => {
    expect(validateAccelerator(input)).toBe(canon);
  });

  it.each([
    [''], ['R'], ['Shift+R'], ['Ctrl+'], ['+R'], ['Ctrl+Shift'], ['Ctrl+Foo+R'], ['Ctrl+RR'], ['Ctrl++'],
    ['Ctrl+F25'], ['Ctrl+Shift+R+S'], [42], [null], [undefined], [{}], ['Ctrl+' + 'a'.repeat(100)],
  ])('rejects %j', (input) => {
    expect(validateAccelerator(input)).toBeNull();
  });

  it('allows bare function keys only', () => {
    expect(validateAccelerator('F9')).toBe('F9');
    expect(validateAccelerator('Space')).toBeNull();
  });
});

describe('sanitizeHotkeys', () => {
  it('defaults for garbage, keeps valid, canonicalizes, empty disables', () => {
    expect(sanitizeHotkeys(null)).toEqual(DEFAULT_HOTKEYS);
    expect(sanitizeHotkeys({ toggle: 'nope', pause: 7 })).toEqual(DEFAULT_HOTKEYS);
    const h = sanitizeHotkeys({ toggle: 'ctrl+alt+r', pause: '', screenshot: 'F10' });
    expect(h).toEqual({ toggle: 'Control+Alt+R', pause: '', screenshot: 'F10', annotate: DEFAULT_HOTKEYS.annotate, zoomIn: DEFAULT_HOTKEYS.zoomIn, zoomOut: DEFAULT_HOTKEYS.zoomOut, zoomReset: DEFAULT_HOTKEYS.zoomReset, toggleCamera: DEFAULT_HOTKEYS.toggleCamera });
  });
  it('disables a later duplicate', () => {
    const h = sanitizeHotkeys({ toggle: 'Ctrl+Shift+Q', pause: 'shift+ctrl+q' });
    expect(h.toggle).toBe('Control+Shift+Q');
    expect(h.pause).toBe('');
  });
  it('findHotkeyConflict ignores the edited action and empty values', () => {
    expect(findHotkeyConflict(DEFAULT_HOTKEYS, 'toggle', DEFAULT_HOTKEYS.pause)).toBe('pause');
    expect(findHotkeyConflict(DEFAULT_HOTKEYS, 'toggle', DEFAULT_HOTKEYS.toggle)).toBeNull();
    expect(findHotkeyConflict({ ...DEFAULT_HOTKEYS, pause: '' }, 'toggle', '')).toBeNull();
  });
});

describe('createHotkeyManager', () => {
  function fakeGs(opts: { taken?: string[]; throwOn?: string[] } = {}) {
    const bound = new Map<string, () => void>();
    return {
      bound,
      gs: {
        register: vi.fn((acc: string, cb: () => void) => {
          if (opts.throwOn?.includes(acc)) throw new Error('bad accelerator');
          if (opts.taken?.includes(acc) || bound.has(acc)) return false;
          bound.set(acc, cb);
          return true;
        }),
        unregister: vi.fn((acc: string) => { bound.delete(acc); }),
      },
    };
  }

  it('registers all and routes callbacks to actions', () => {
    const { gs, bound } = fakeGs();
    const onAction = vi.fn();
    const m = createHotkeyManager(gs, onAction);
    const st = m.apply(DEFAULT_HOTKEYS);
    expect(st).toEqual({ registered: ['toggle', 'pause', 'screenshot', 'annotate', 'zoomIn', 'zoomOut', 'zoomReset', 'toggleCamera'], failed: [] });
    bound.get(DEFAULT_HOTKEYS.pause)!();
    expect(onAction).toHaveBeenCalledWith('pause');
  });

  it('reports failures without throwing and keeps the rest', () => {
    const { gs } = fakeGs({ taken: [DEFAULT_HOTKEYS.toggle], throwOn: [DEFAULT_HOTKEYS.screenshot] });
    const st = createHotkeyManager(gs, vi.fn()).apply(DEFAULT_HOTKEYS);
    expect(st.registered).toEqual(['pause', 'annotate', 'zoomIn', 'zoomOut', 'zoomReset', 'toggleCamera']);
    expect(st.failed.map((f) => f.action)).toEqual(['toggle', 'screenshot']);
    expect(st.failed[0].reason).toMatch(/in use/);
    expect(st.failed[1].reason).toBe('bad accelerator');
  });

  it('reports invalid strings, skips disabled ones', () => {
    const { gs } = fakeGs();
    const st = createHotkeyManager(gs, vi.fn()).apply({ toggle: 'garbage', pause: '', screenshot: 'F10', annotate: '', zoomIn: '', zoomOut: '', zoomReset: '', toggleCamera: '' });
    expect(st.registered).toEqual(['screenshot']);
    expect(st.failed).toEqual([{ action: 'toggle', accelerator: 'garbage', reason: 'invalid shortcut' }]);
  });

  it('re-apply releases old bindings; dispose releases everything', () => {
    const { gs, bound } = fakeGs();
    const m = createHotkeyManager(gs, vi.fn());
    m.apply(DEFAULT_HOTKEYS);
    m.apply({ toggle: 'F9', pause: '', screenshot: '', annotate: '', zoomIn: '', zoomOut: '', zoomReset: '', toggleCamera: '' });
    expect([...bound.keys()]).toEqual(['F9']);
    m.dispose();
    expect(bound.size).toBe(0);
    expect(m.status()).toEqual({ registered: [], failed: [] });
  });
});

describe('quality presets', () => {
  it('table is sane and ids unique', () => {
    expect(new Set(QUALITY_PRESETS.map((p) => p.id)).size).toBe(QUALITY_PRESETS.length);
    for (const p of QUALITY_PRESETS) {
      expect(p.fps).toBeGreaterThanOrEqual(24);
      expect(p.maxWidth / p.maxHeight).toBeCloseTo(16 / 9);
      expect(p.videoBitsPerSecond).toBeGreaterThan(1_000_000);
    }
    expect(qualityPreset('720p30')).toMatchObject({ maxWidth: 1280, maxHeight: 720, fps: 30 });
    expect(qualityPreset('1080p60')).toMatchObject({ maxWidth: 1920, fps: 60 });
    expect(qualityPreset('1080p60').videoBitsPerSecond).toBeGreaterThan(qualityPreset('1080p30').videoBitsPerSecond);
  });
  it('unknown id falls back to the default', () => {
    expect(qualityPreset('4k')).toBe(qualityPreset(DEFAULT_SETTINGS.quality));
    expect(qualityPreset(undefined).id).toBe('1080p30');
  });
});

describe('sanitizeSettings: new fields', () => {
  it('defaults', () => {
    const s = sanitizeSettings({});
    expect(s.micProcessing).toBe(true);
    expect(s.quality).toBe('1080p30');
    expect(s.hotkeys).toEqual(DEFAULT_HOTKEYS);
    expect(s.overlay.mirror).toBe(true);
    expect(s.overlay.border).toEqual({ enabled: true, color: '#ffffff', width: 3 });
  });
  it('validates and clamps', () => {
    const s = sanitizeSettings({
      micProcessing: 'yes', quality: '8k', hotkeys: { toggle: 'x' },
      overlay: { mirror: false, border: { enabled: false, color: 'red', width: 999 } },
    });
    expect(s.micProcessing).toBe(true);
    expect(s.quality).toBe('1080p30');
    expect(s.hotkeys.toggle).toBe(DEFAULT_HOTKEYS.toggle);
    expect(s.overlay.mirror).toBe(false);
    expect(s.overlay.border).toEqual({ enabled: false, color: '#ffffff', width: 16 });
    expect(sanitizeSettings({ overlay: { border: { width: -5 } } }).overlay.border.width).toBe(1);
    expect(sanitizeSettings({ overlay: { border: 'x' } }).overlay.border).toEqual(DEFAULT_SETTINGS.overlay.border);
    expect(sanitizeSettings({ quality: '720p30', micProcessing: false })).toMatchObject({ quality: '720p30', micProcessing: false });
  });
  it('is idempotent', () => {
    const once = sanitizeSettings({ hotkeys: { toggle: 'ctrl+alt+z' }, quality: '1080p60' });
    expect(sanitizeSettings(once)).toEqual(once);
  });
});

describe('gif ffmpeg args', () => {
  const win = 'C:\\Users\\WINDOWS 10\\my rec; calc & x.webm';
  it('pass 1 builds an arg array with the path untouched and palettegen', () => {
    const a = buildGifPaletteArgs(win, 'C:\\tmp dir\\palette.png');
    expect(a[a.indexOf('-i') + 1]).toBe(win);
    expect(a[a.length - 1]).toBe('C:\\tmp dir\\palette.png');
    const vf = a[a.indexOf('-vf') + 1];
    expect(vf).toContain('palettegen');
    expect(vf).toContain('fps=12');
    expect(vf).toContain('min(640\\,iw)');
  });
  it('pass 2 takes the palette as a second input and uses paletteuse', () => {
    const a = buildGifArgs(win, 'p.png', 'out dir\\o.gif');
    expect(a.filter((x) => x === '-i')).toHaveLength(2);
    expect(a[a.indexOf('-i', a.indexOf('-i') + 1) + 1]).toBe('p.png');
    expect(a[a.indexOf('-lavfi') + 1]).toContain('paletteuse');
    expect(a).toContain('-an');
    expect(a[a.length - 1]).toBe('out dir\\o.gif');
  });
  it('caps fps and width, falls back for junk', () => {
    const big = buildGifPaletteArgs('i', 'p', { fps: 60, maxWidth: 4000 }).join(' ');
    expect(big).toContain(`fps=${GIF_MAX_FPS},`);
    expect(big).toContain(`min(${GIF_MAX_WIDTH}\\,iw)`);
    const junk = buildGifPaletteArgs('i', 'p', { fps: NaN, maxWidth: -3 }).join(' ');
    expect(junk).toContain('fps=12,');
    expect(junk).toContain('min(16\\,iw)');
  });
  it('convertToGif runs both passes in order and removes the palette dir', async () => {
    const calls: string[][] = [];
    const spawnFn = ((_bin: string, args: string[]) => {
      calls.push(args);
      const c = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      c.stderr = new EventEmitter();
      setTimeout(() => c.emit('close', 0), 0);
      return c;
    }) as never;
    await convertToGif('in.webm', 'out.gif', {}, spawnFn);
    expect(calls).toHaveLength(2);
    expect(calls[0].join(' ')).toContain('palettegen');
    expect(calls[1].join(' ')).toContain('paletteuse');
    const palette = calls[0][calls[0].length - 1];
    expect(calls[1]).toContain(palette);
    await expect(fsp.stat(path.dirname(palette))).rejects.toThrow();
  });
  it('convertToGif rejects when pass 1 fails and skips pass 2', async () => {
    let n = 0;
    const spawnFn = (() => {
      n++;
      const c = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      c.stderr = new EventEmitter();
      setTimeout(() => { c.stderr.emit('data', Buffer.from('boom')); c.emit('close', 1); }, 0);
      return c;
    }) as never;
    await expect(convertToGif('i', 'o', {}, spawnFn)).rejects.toThrow('boom');
    expect(n).toBe(1);
  });
});

describe('screenshots', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  it('names with a timestamp', () => {
    expect(screenshotName(new Date(2026, 0, 2, 3, 4, 5))).toBe('screenshot-2026-01-02-03-04-05');
  });
  it('validates PNG payloads', () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(toPngBytes(PNG.buffer.slice(0) as ArrayBuffer).byteLength).toBe(PNG.byteLength);
    expect(toPngBytes(PNG).byteLength).toBe(PNG.byteLength);
  });
  it('rejects non-binary and non-PNG payloads', () => {
    for (const bad of ['x', null, 5, {}, new Uint8Array(20), new ArrayBuffer(0)]) {
      expect(() => toPngBytes(bad)).toThrow();
    }
  });
  it('writes without overwriting', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shot-test-'));
    try {
      const now = new Date(2026, 5, 7, 8, 9, 10);
      const a = await writeScreenshot(path.join(dir, 'sub'), PNG, now);
      const b = await writeScreenshot(path.join(dir, 'sub'), PNG, now);
      expect(path.basename(a)).toBe('screenshot-2026-06-07-08-09-10.png');
      expect(path.basename(b)).toBe('screenshot-2026-06-07-08-09-10 (1).png');
      expect(new Uint8Array(await fsp.readFile(a))).toEqual(PNG);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('legacy zoom hotkey migration', () => {
  it('replaces the old Ctrl+Alt+Plus/-/0 defaults saved in settings.json with the current defaults', async () => {
    const { sanitizeHotkeys, DEFAULT_HOTKEYS } = await import('../src/shared/hotkeys');
    const h = sanitizeHotkeys({ zoomIn: 'Control+Alt+Plus', zoomOut: 'Control+Alt+-', zoomReset: 'Control+Alt+0' });
    expect(h.zoomIn).toBe(DEFAULT_HOTKEYS.zoomIn);
    expect(h.zoomOut).toBe(DEFAULT_HOTKEYS.zoomOut);
    expect(h.zoomReset).toBe(DEFAULT_HOTKEYS.zoomReset);
    expect(sanitizeHotkeys({ zoomIn: 'Control+Alt+Z' }).zoomIn).toBe('Control+Alt+Z');
  });
});
