import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { buildMp4Args, convertToMp4, detectFfmpeg } from '../src/main/ffmpeg';
import { SettingsStore, type FsLike } from '../src/main/settings-store';
import { computeOverlayRect, coverCrop, fitContain, scaleToMax } from '../src/shared/overlay-layout';
import { createElapsedClock, formatElapsed, initialState, reduce, type RecEvent, type RecState } from '../src/shared/recorder-machine';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings';
import { timestampName } from '../src/shared/format';

const canvas = { width: 1920, height: 1080 };
describe('overlay corners / margins / clamps', () => {
  const base = { sizePercent: 20, marginPercent: 2, aspect: 1 };
  it('all four corners stay inside canvas and respect margin', () => {
    const w = Math.round(1920 * 0.2);
    const m = Math.round(1920 * 0.02);
    expect(computeOverlayRect(canvas, { ...base, corner: 'top-left' })).toEqual({ x: m, y: m, width: w, height: w });
    expect(computeOverlayRect(canvas, { ...base, corner: 'top-right' })).toEqual({ x: 1920 - w - m, y: m, width: w, height: w });
    expect(computeOverlayRect(canvas, { ...base, corner: 'bottom-left' })).toEqual({ x: m, y: 1080 - w - m, width: w, height: w });
    expect(computeOverlayRect(canvas, { ...base, corner: 'bottom-right' })).toEqual({ x: 1920 - w - m, y: 1080 - w - m, width: w, height: w });
  });
  it('size clamps to 10..40 percent', () => {
    expect(computeOverlayRect(canvas, { ...base, sizePercent: 1, corner: 'top-left' }).width).toBe(192);
    expect(computeOverlayRect(canvas, { ...base, sizePercent: 100, corner: 'top-left' }).width).toBe(768);
  });
  it('never yields negative origin on tiny canvases', () => {
    const r = computeOverlayRect({ width: 100, height: 20 }, { corner: 'bottom-right', sizePercent: 40, marginPercent: 10, aspect: 1 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
  it('invalid aspect falls back to 1', () => {
    expect(computeOverlayRect(canvas, { ...base, corner: 'top-left', aspect: 0 }).height).toBe(384);
    expect(computeOverlayRect(canvas, { ...base, corner: 'top-left', aspect: -2 }).height).toBe(384);
  });
  it('degenerate sizes do not produce NaN', () => {
    expect(coverCrop({ width: 0, height: 0 }, { width: 10, height: 10 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(fitContain({ width: 0, height: 0 }, { width: 10, height: 10 })).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
  it('scaleToMax never upscales and keeps even sizes', () => {
    expect(scaleToMax({ width: 640, height: 360 }, 1920, 1080)).toEqual({ width: 640, height: 360 });
    const s = scaleToMax({ width: 2561, height: 1441 }, 1920, 1080);
    expect(s.width % 2).toBe(0);
    expect(s.height % 2).toBe(0);
    expect(s.width).toBeLessThanOrEqual(1920);
    expect(s.height).toBeLessThanOrEqual(1080);
  });
});

describe('settings sanitize edge cases', () => {
  it('rejects arrays, wrong types, bad enums; accepts valid colors', () => {
    expect(sanitizeSettings([])).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({
      cameraEnabled: 'yes', micEnabled: false, sourceId: 5, cameraDeviceId: '',
      background: { color: '#ABCDEF', mode: 'video', blurRadius: NaN },
      overlay: { sizePercent: -5, shape: 'square' },
    });
    expect(s.cameraEnabled).toBe(true);
    expect(s.micEnabled).toBe(false);
    expect(s.sourceId).toBeNull();
    expect(s.cameraDeviceId).toBeNull();
    expect(s.background.color).toBe('#ABCDEF');
    expect(s.background.mode).toBe('none');
    expect(s.background.blurRadius).toBe(DEFAULT_SETTINGS.background.blurRadius);
    expect(s.overlay.sizePercent).toBe(10);
    expect(s.overlay.shape).toBe('circle');
  });
  it('rejects 3-digit and non-hex colors', () => {
    expect(sanitizeSettings({ background: { color: '#fff' } }).background.color).toBe('#1e90ff');
    expect(sanitizeSettings({ background: { color: '#gggggg' } }).background.color).toBe('#1e90ff');
  });
  it('does not mutate DEFAULT_SETTINGS and returns fresh objects', () => {
    const a = sanitizeSettings(null);
    a.overlay.corner = 'top-left';
    expect(DEFAULT_SETTINGS.overlay.corner).toBe('bottom-right');
  });
  it('marginPercent is not user-controllable (documents current behaviour)', () => {
    expect(sanitizeSettings({ overlay: { marginPercent: 30 } }).overlay.marginPercent).toBe(DEFAULT_SETTINGS.overlay.marginPercent);
  });
});

function memFs(files: Record<string, string> = {}, failWrite = false) {
  const fs: FsLike = {
    readFile: async (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
    writeFile: async (p, d) => { if (failWrite) throw new Error('EACCES'); files[p] = d; },
    rename: async (a, b) => { files[b] = files[a]; delete files[a]; },
    mkdir: async () => undefined,
  };
  return { fs, files };
}
describe('SettingsStore persistence', () => {
  const p = 'C:\\Users\\WINDOWS 10\\AppData\\Roaming\\screen-recorder\\settings.json';
  it('round-trips through a fresh store', async () => {
    const m = memFs();
    await new SettingsStore(p, m.fs).save({ ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay, corner: 'top-left' } });
    expect((await new SettingsStore(p, m.fs).load()).overlay.corner).toBe('top-left');
    expect(Object.keys(m.files)).toEqual([p]);
  });
  it('persists captureMode camera across stores', async () => {
    const m = memFs();
    await new SettingsStore(p, m.fs).save({ ...DEFAULT_SETTINGS, captureMode: 'camera' });
    expect((await new SettingsStore(p, m.fs).load()).captureMode).toBe('camera');
  });
  it('old settings file without captureMode loads as screen', async () => {
    const old = { version: 1, overlay: { ...DEFAULT_SETTINGS.overlay, corner: 'top-left' }, background: DEFAULT_SETTINGS.background };
    const s = await new SettingsStore(p, memFs({ [p]: JSON.stringify(old) }).fs).load();
    expect(s.captureMode).toBe('screen');
    expect(s.overlay.corner).toBe('top-left');
  });
  it('sanitizes tampered file contents on load', async () => {
    const m = memFs({ [p]: JSON.stringify({ overlay: { sizePercent: 9999, corner: '../x' } }) });
    const s = await new SettingsStore(p, m.fs).load();
    expect(s.overlay.sizePercent).toBe(40);
    expect(s.overlay.corner).toBe('bottom-right');
  });
  it('empty, null, array and number files fall back to defaults', async () => {
    for (const t of ['', 'null', '[]', '123']) {
      expect(await new SettingsStore(p, memFs({ [p]: t }).fs).load()).toEqual(DEFAULT_SETTINGS);
    }
  });
  it('get() before load returns defaults; failed save propagates and keeps cache', async () => {
    const st = new SettingsStore(p, memFs({}, true).fs);
    expect(st.get()).toEqual(DEFAULT_SETTINGS);
    await expect(st.save({ ...DEFAULT_SETTINGS, micEnabled: false })).rejects.toThrow('EACCES');
    expect(st.get().micEnabled).toBe(true);
  });
});

function child(fn: (c: any) => void) {
  return ((..._a: unknown[]) => {
    const c: any = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = () => undefined;
    setTimeout(() => fn(c), 0);
    return c;
  }) as never;
}

describe('ffmpeg builder and fallback', () => {
  it('passes input/output as single argv entries even with spaces and quotes', () => {
    const inp = 'C:\\Users\\WINDOWS 10\\AppData\\Local\\Temp\\rec 1.webm';
    const out = 'C:\\Users\\WINDOWS 10\\Videos\\my "quoted" & rec.mp4';
    const a = buildMp4Args(inp, out);
    expect(a[a.indexOf('-i') + 1]).toBe(inp);
    expect(a[a.length - 1]).toBe(out);
    expect(a).toContain('+faststart');
    expect(a).toContain('libx264');
  });
  it('spawn receives args array (no shell) with the exact paths and custom binary', async () => {
    let seen: { bin: string; args: string[]; opts: any } | null = null;
    const spawnFn = ((bin: string, args: string[], opts: any) => {
      seen = { bin, args, opts };
      const c: any = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      setTimeout(() => c.emit('close', 0), 0);
      return c;
    }) as never;
    await convertToMp4('C:\\a b\\in.webm', 'C:\\c d\\out.mp4', spawnFn, 'C:\\ff mpeg\\ffmpeg.exe');
    expect(seen!.bin).toBe('C:\\ff mpeg\\ffmpeg.exe');
    expect(seen!.args).toContain('C:\\a b\\in.webm');
    expect(seen!.opts.shell).toBeFalsy();
  });
  it('missing ffmpeg: synchronous spawn throw => unavailable / reject', async () => {
    const throwing = (() => { throw new Error('ENOENT'); }) as never;
    expect(await detectFfmpeg(throwing)).toEqual({ available: false, version: null });
    await expect(convertToMp4('a', 'b', throwing)).rejects.toThrow('ENOENT');
  });
  it('convert: error event rejects; stderr truncated to 500; empty stderr reports exit code', async () => {
    await expect(convertToMp4('a', 'b', child((c) => c.emit('error', new Error('spawn ffmpeg ENOENT'))))).rejects.toThrow('ENOENT');
    const err: Error = await convertToMp4('a', 'b', child((c) => { c.stderr.emit('data', 'x'.repeat(2000)); c.emit('close', 1); })).catch((e) => e);
    expect(err.message.length).toBe(500);
    await expect(convertToMp4('a', 'b', child((c) => c.emit('close', 7)))).rejects.toThrow('code 7');
  });
  it('exit 0 without version output => unavailable', async () => {
    expect((await detectFfmpeg(child((c) => c.emit('close', 0)))).available).toBe(false);
  });
});

describe('recorder state machine exhaustive', () => {
  const events: RecEvent[] = [
    { type: 'START' }, { type: 'TICK' }, { type: 'CANCEL' }, { type: 'PAUSE' },
    { type: 'RESUME' }, { type: 'STOP' }, { type: 'STOPPED' },
  ];
  const states: RecState[] = [
    { phase: 'idle' }, { phase: 'countdown', remaining: 2 }, { phase: 'recording' }, { phase: 'paused' }, { phase: 'stopping' },
  ];
  // expected phase after event per state; '=' means state object unchanged
  const table: Record<string, Record<string, string>> = {
    idle: { START: 'countdown', TICK: '=', CANCEL: '=', PAUSE: '=', RESUME: '=', STOP: '=', STOPPED: '=' },
    countdown: { START: '=', TICK: 'countdown', CANCEL: 'idle', PAUSE: '=', RESUME: '=', STOP: '=', STOPPED: '=' },
    recording: { START: '=', TICK: '=', CANCEL: '=', PAUSE: 'paused', RESUME: '=', STOP: 'stopping', STOPPED: '=' },
    paused: { START: '=', TICK: '=', CANCEL: '=', PAUSE: '=', RESUME: 'recording', STOP: 'stopping', STOPPED: '=' },
    stopping: { START: '=', TICK: '=', CANCEL: '=', PAUSE: '=', RESUME: '=', STOP: '=', STOPPED: 'idle' },
  };
  for (const s of states) {
    for (const e of events) {
      it(`${s.phase} + ${e.type}`, () => {
        const out = reduce(s, e);
        const exp = table[s.phase][e.type];
        if (exp === '=') expect(out).toBe(s);
        else expect(out.phase).toBe(exp);
      });
    }
  }
  it('countdown values', () => {
    expect(reduce(initialState(), { type: 'START', countdownFrom: 5 })).toEqual({ phase: 'countdown', remaining: 5 });
    expect(reduce(initialState(), { type: 'START', countdownFrom: 0 })).toEqual({ phase: 'recording' });
    expect(reduce(initialState(), { type: 'START', countdownFrom: -1 })).toEqual({ phase: 'recording' });
    expect(reduce({ phase: 'countdown', remaining: 1 }, { type: 'TICK' })).toEqual({ phase: 'recording' });
  });
  it('clock: repeated pauses, idempotent pause/resume, stop freezes, reset zeroes', () => {
    let t = 100;
    const c = createElapsedClock(() => t);
    expect(c.elapsedMs()).toBe(0);
    c.start(); t += 1000; c.pause(); c.pause(); t += 9999; c.resume(); c.resume(); t += 500;
    expect(c.elapsedMs()).toBe(1500);
    c.stop(); t += 5000;
    expect(c.elapsedMs()).toBe(1500);
    c.reset();
    expect(c.elapsedMs()).toBe(0);
    c.start(); t += 10;
    expect(c.elapsedMs()).toBe(10);
  });
  it('formatElapsed edge values', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(999)).toBe('00:00');
    expect(formatElapsed(59_999)).toBe('00:59');
    expect(formatElapsed(3_599_000)).toBe('59:59');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(NaN)).toBe('00:00');
    expect(formatElapsed(Infinity)).toBe('00:00');
  });
  it('timestampName pads and matches the IPC safe-name pattern', () => {
    const n = timestampName(new Date(2026, 0, 2, 3, 4, 5));
    expect(n).toBe('recording-2026-01-02-03-04-05');
    expect(/^[A-Za-z0-9._-]{1,100}$/.test(n)).toBe(true);
  });
});
