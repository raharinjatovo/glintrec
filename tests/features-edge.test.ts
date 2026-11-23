import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { buildGifArgs, buildGifPaletteArgs, buildMp4Args, convertToMp4 } from '../src/main/ffmpeg';
import { createHotkeyManager } from '../src/main/hotkeys';
import { SettingsStore, type FsLike } from '../src/main/settings-store';
import { toPngBytes } from '../src/main/screenshot';
import { DEFAULT_HOTKEYS, sanitizeHotkeys, validateAccelerator } from '../src/shared/hotkeys';
import { QUALITY_PRESETS, qualityPreset } from '../src/shared/quality';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';

describe('accelerator edge cases', () => {
  it.each([
    [' '], ['   +   '], ['Ctrl+ '], ['Ctrl +\tR\n'.replace('\n', 'x')], ['Ctrl+Shift+\u0000'], ['Ctrl+Ж'],
    ['Ctrl+Alt+Del'], ['Ctrl+Ctrl'], ['Ctrl+Shift+Shift'], ['CommandOrControl'], ['Ctrl+R;calc'],
    ['Ctrl+R\u0000'], ['Ctrl+F0'], ['Ctrl+F025'], ['__proto__'], ['constructor'], ['Ctrl+toString'],
  ])('rejects %j', (input) => {
    expect(validateAccelerator(input)).toBeNull();
  });

  it('rejects non-string inputs and very long strings', () => {
    for (const v of [true, 0, [], ['Ctrl+R'], () => 'Ctrl+R', Symbol.iterator as unknown, NaN]) {
      expect(validateAccelerator(v)).toBeNull();
    }
    expect(validateAccelerator('a'.repeat(65))).toBeNull();
  });

  it('is idempotent on canonical output', () => {
    for (const raw of ['ctrl+shift+r', 'Cmd+Alt+f5', 'Super+num0']) {
      const once = validateAccelerator(raw)!;
      expect(validateAccelerator(once)).toBe(once);
    }
  });

  it('treats alias combos as the same shortcut when deduping', () => {
    const h = sanitizeHotkeys({ toggle: 'Ctrl+Alt+K', pause: 'alt+control+k', screenshot: 'Alt+Ctrl+K' });
    expect(h).toEqual({ toggle: 'Control+Alt+K', pause: '', screenshot: '', annotate: DEFAULT_HOTKEYS.annotate,
      zoomIn: DEFAULT_HOTKEYS.zoomIn, zoomOut: DEFAULT_HOTKEYS.zoomOut, zoomReset: DEFAULT_HOTKEYS.zoomReset, toggleCamera: DEFAULT_HOTKEYS.toggleCamera });
  });

  it('tolerates hostile hotkey containers', () => {
    for (const raw of [undefined, 5, 'x', [], [1, 2]]) {
      expect(sanitizeHotkeys(raw)).toEqual(DEFAULT_HOTKEYS);
    }
  });

  it('does not mutate the shared defaults', () => {
    const h = sanitizeHotkeys({ toggle: '' });
    h.pause = 'tampered';
    expect(DEFAULT_HOTKEYS.pause).toBe('CommandOrControl+Shift+P');
    expect(sanitizeSettings({}).hotkeys).not.toBe(DEFAULT_SETTINGS.hotkeys);
  });
});

describe('hotkey manager edge cases', () => {
  it('survives a registrar that throws on unregister', () => {
    const gs = { register: vi.fn(() => true), unregister: vi.fn(() => { throw new Error('gone'); }) };
    const m = createHotkeyManager(gs, () => undefined);
    m.apply(DEFAULT_HOTKEYS);
    expect(() => m.apply(DEFAULT_HOTKEYS)).not.toThrow();
    expect(() => m.dispose()).not.toThrow();
    expect(m.status()).toEqual({ registered: [], failed: [] });
  });

  it('apply with junk values reports failures and registers nothing for them', () => {
    const gs = { register: vi.fn(() => true), unregister: vi.fn() };
    const m = createHotkeyManager(gs, () => undefined);
    const st = m.apply({ toggle: 'R', pause: 'Ctrl+Foo', screenshot: '' } as never);
    expect(gs.register).not.toHaveBeenCalled();
    expect(st.registered).toEqual([]);
    expect(st.failed.map((f) => f.action)).toEqual(['toggle', 'pause']);
  });

  it('two actions mapped to the same combo only register once', () => {
    const gs = { register: vi.fn(() => true), unregister: vi.fn() };
    const m = createHotkeyManager(gs, () => undefined);
    const st = m.apply({ toggle: 'Ctrl+Q', pause: 'control+q', screenshot: 'F9', annotate: '', zoomIn: '', zoomOut: '', zoomReset: '', toggleCamera: '' });
    expect(gs.register).toHaveBeenCalledTimes(2);
    expect(st.failed).toEqual([expect.objectContaining({ action: 'pause', reason: 'already used by another action' })]);
  });
});

describe('quality preset bounds', () => {
  it.each([[undefined], [null], [''], ['4K'], ['1080P30'], [30], [{}], [['720p30']], ['__proto__'], ['toString']])(
    'unknown id %j falls back to 1080p30',
    (id) => {
      expect(qualityPreset(id).id).toBe('1080p30');
    },
  );

  it('every preset is internally consistent and monotonic', () => {
    for (const p of QUALITY_PRESETS) {
      expect(Number.isInteger(p.maxWidth) && Number.isInteger(p.maxHeight)).toBe(true);
      expect(p.maxWidth % 2 === 0 && p.maxHeight % 2 === 0).toBe(true);
      expect(p.fps).toBeLessThanOrEqual(60);
      expect(p.id.startsWith(`${p.maxHeight}p${p.fps}`)).toBe(true);
      expect(p.videoBitsPerSecond).toBeLessThanOrEqual(50_000_000);
    }
    const hd = qualityPreset('720p30');
    const fhd = qualityPreset('1080p30');
    expect(fhd.maxWidth).toBeGreaterThan(hd.maxWidth);
    expect(fhd.videoBitsPerSecond).toBeGreaterThan(hd.videoBitsPerSecond);
  });
});

describe('sanitizeSettings: migration of old settings files', () => {
  // A v1 file written before hotkeys/quality/micProcessing/mirror/border existed.
  const legacy = {
    version: 1, captureMode: 'screen', sourceId: 'screen:0:0', cameraDeviceId: 'cam1', micDeviceId: null,
    cameraEnabled: true, micEnabled: false, systemAudioEnabled: true, videoOnly: false,
    background: { mode: 'blur', color: '#112233', imagePath: null, blurRadius: 20 },
    overlay: { corner: 'top-left', sizePercent: 30, shape: 'rounded', marginPercent: 2, pos: { x: 0.25, y: 0.75 } },
  };

  it('keeps old values and fills every new field with defaults', () => {
    const s = sanitizeSettings(legacy);
    expect(s).toMatchObject({
      sourceId: 'screen:0:0', cameraDeviceId: 'cam1', micEnabled: false, systemAudioEnabled: true,
      background: { mode: 'blur', color: '#112233', blurRadius: 20 },
      overlay: { corner: 'top-left', sizePercent: 30, shape: 'rounded', pos: { x: 0.25, y: 0.75 } },
      micProcessing: true, quality: '1080p30', hotkeys: DEFAULT_HOTKEYS,
    });
    expect(s.overlay.mirror).toBe(true);
    expect(s.overlay.border).toEqual({ enabled: true, color: '#ffffff', width: 3 });
  });

  it('a legacy file that predates overlay.pos still loads', () => {
    const { pos: _p, ...ov } = legacy.overlay;
    expect(sanitizeSettings({ ...legacy, overlay: ov }).overlay.pos).toBeNull();
  });

  it('SettingsStore.load migrates a legacy file on disk', async () => {
    const fs: FsLike = {
      readFile: async () => JSON.stringify(legacy),
      writeFile: async () => undefined, rename: async () => undefined, mkdir: async () => undefined,
    };
    const s = await new SettingsStore('x.json', fs).load();
    expect(s.hotkeys).toEqual(DEFAULT_HOTKEYS);
    expect(s.quality).toBe('1080p30');
  });

  it.each([
    ['truncated JSON', '{"quality": "720p30", "hotk'],
    ['empty file', ''],
    ['JSON null', 'null'],
    ['JSON array', '[1,2,3]'],
    ['JSON string', '"hi"'],
    ['BOM prefix', '\ufeff{"quality":"720p30"}'],
  ])('SettingsStore.load falls back to defaults on %s', async (_n, text) => {
    const fs: FsLike = {
      readFile: async () => text,
      writeFile: async () => undefined, rename: async () => undefined, mkdir: async () => undefined,
    };
    const s = await new SettingsStore('x.json', fs).load();
    expect(s).toEqual(sanitizeSettings(DEFAULT_SETTINGS));
  });

  it('wrong types for every new field fall back individually', () => {
    const s = sanitizeSettings({
      micProcessing: null, quality: 720, hotkeys: [], overlay: { mirror: 'true', border: { enabled: 1, color: 5, width: '3' } },
    });
    expect(s.micProcessing).toBe(true);
    expect(s.quality).toBe('1080p30');
    expect(s.hotkeys).toEqual(DEFAULT_HOTKEYS);
    expect(s.overlay.mirror).toBe(true);
    expect(s.overlay.border).toEqual({ enabled: true, color: '#ffffff', width: 3 });
  });

  it('border width: NaN/Infinity/fractions/extremes', () => {
    const w = (v: unknown) => sanitizeSettings({ overlay: { border: { width: v } } }).overlay.border.width;
    expect(w(NaN)).toBe(3);
    expect(w(Infinity)).toBe(3);
    expect(w(2.6)).toBe(3);
    expect(w(0)).toBe(1);
    expect(w(1e9)).toBe(16);
  });

  it('border colour only accepts #rrggbb', () => {
    const c = (v: unknown) => sanitizeSettings({ overlay: { border: { color: v } } }).overlay.border.color;
    expect(c('#ABCDEF')).toBe('#ABCDEF');
    expect(c('#abc')).toBe('#ffffff');
    expect(c('url(javascript:1)')).toBe('#ffffff');
    expect(c('#ffffff;background:red')).toBe('#ffffff');
  });

  it('ignores __proto__ pollution in raw JSON', () => {
    const s = sanitizeSettings(JSON.parse('{"__proto__":{"quality":"720p30"},"hotkeys":{"__proto__":{"toggle":"F1"}}}'));
    expect(s.quality).toBe('1080p30');
    expect(s.hotkeys).toEqual(DEFAULT_HOTKEYS);
    expect(({} as Record<string, unknown>).quality).toBeUndefined();
  });
});

describe('ffmpeg argument safety with odd paths', () => {
  const odd = [
    'C:\\Users\\A B\\rec "quoted" & calc.webm',
    "/tmp/it's $(whoami) `id`; rm -rf ~.webm",
    '/tmp/%USERPROFILE%/..\\..\\x.webm',
    'C:\\тест\\видео 😀.webm',
    '/tmp/new\nline.webm',
    'a,b[0]:c=d.webm',
  ];

  it.each(odd)('mp4 args keep %j as exactly one argv entry', (p) => {
    const a = buildMp4Args(p, p + '.out.mp4');
    expect(a.filter((x) => x === p)).toHaveLength(1);
    expect(a[a.indexOf('-i') + 1]).toBe(p);
    expect(a[a.length - 1]).toBe(p + '.out.mp4');
  });

  it.each(odd)('gif args never put %j in a filter graph', (p) => {
    const pal = p + '.palette.png';
    for (const a of [buildGifPaletteArgs(p, pal), buildGifArgs(p, pal, p + '.gif')]) {
      const graph = a[a.indexOf(a.includes('-lavfi') ? '-lavfi' : '-vf') + 1];
      expect(graph).not.toContain(p);
      expect(graph).not.toContain(pal);
      expect(a[a.indexOf('-i') + 1]).toBe(p);
    }
  });

  it('filter strings contain only numbers chosen by the program, even for hostile options', () => {
    const o = { fps: '15;movie=/etc/passwd' as unknown as number, maxWidth: '1,2' as unknown as number };
    const g = buildGifPaletteArgs('i', 'p', o).join(' ');
    expect(g).toContain('fps=12,');
    expect(g).not.toContain('movie');
    expect(g).not.toContain('passwd');
  });

  it('mp4 pad filter is static', () => {
    const a = buildMp4Args('in.webm', 'out.mp4');
    expect(a[a.indexOf('-vf') + 1]).toBe('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    expect(a).toContain('-y');
  });

  it('convertToMp4 passes args as an array and does not request a shell', async () => {
    const calls: Array<{ bin: string; args: string[]; opts: Record<string, unknown> }> = [];
    const spawnFn = ((bin: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ bin, args, opts });
      const c = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      c.stderr = new EventEmitter();
      setTimeout(() => c.emit('close', 0), 0);
      return c;
    }) as never;
    await convertToMp4("in; calc & '.webm", 'out.mp4', spawnFn);
    expect(calls).toHaveLength(1);
    expect(Array.isArray(calls[0].args)).toBe(true);
    expect(calls[0].opts.shell).toBeFalsy();
  });

  it('convertToMp4 rejects with a trimmed stderr tail on non-zero exit and on spawn error', async () => {
    const mk = (mode: 'exit' | 'error') => ((() => {
      const c = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      c.stderr = new EventEmitter();
      setTimeout(() => {
        if (mode === 'error') { c.emit('error', new Error('ENOENT')); return; }
        c.stderr.emit('data', Buffer.from('x'.repeat(2000) + 'BOOM'));
        c.emit('close', 1);
      }, 0);
      return c;
    }) as never);
    await expect(convertToMp4('a', 'b', mk('error'))).rejects.toThrow('ENOENT');
    const err = await convertToMp4('a', 'b', mk('exit')).catch((e: Error) => e);
    expect((err as Error).message.length).toBeLessThanOrEqual(500);
    expect((err as Error).message.endsWith('BOOM')).toBe(true);
  });

  // Documents a latent hazard: an output path starting with '-' would be parsed by ffmpeg as an option.
  // Main always passes absolute dialog paths (export.ts), so this is not reachable today.
  it('output path is the final positional argument', () => {
    expect(buildMp4Args('i', 'o.mp4').at(-1)).toBe('o.mp4');
    expect(buildGifArgs('i', 'p', 'o.gif').at(-1)).toBe('o.gif');
  });
});

describe('screenshot payload edge cases', () => {
  const png = (extra = 4) => {
    const u = new Uint8Array(8 + extra);
    u.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return u;
  };
  it('accepts typed-array views with an offset into a bigger buffer', () => {
    const big = new Uint8Array(32);
    big.set(png(), 5);
    expect(toPngBytes(new Uint8Array(big.buffer, 5, 12)).byteLength).toBe(12);
  });
  it('rejects magic-only, truncated magic, empty and plain objects', () => {
    expect(() => toPngBytes(png(0))).toThrow();
    expect(() => toPngBytes(png().slice(0, 7))).toThrow();
    expect(() => toPngBytes(new Uint8Array(0))).toThrow();
    expect(() => toPngBytes({ 0: 0x89, length: 12 })).toThrow();
    expect(() => toPngBytes('\u0089PNG\r\n\u001a\n....')).toThrow();
    expect(() => toPngBytes(null)).toThrow();
  });
});
