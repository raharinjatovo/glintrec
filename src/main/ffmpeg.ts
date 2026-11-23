import { spawn } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FfmpegStatus } from '../shared/ipc';

type SpawnFn = typeof spawn;

/**
 * `trim` (seconds, validated by the caller) is applied as output options after -i: the clip is decoded
 * from the start and cut frame-accurately, which also works for MediaRecorder WebM without a seek index.
 */
export function buildMp4Args(input: string, output: string, trim?: { start: number; end: number }): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    ...(trim ? ['-ss', trim.start.toFixed(3), '-t', (trim.end - trim.start).toFixed(3)] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    output,
  ];
}

export const GIF_MAX_FPS = 15;
export const GIF_MAX_WIDTH = 720;
export interface GifOptions { fps: number; maxWidth: number }
export const DEFAULT_GIF_OPTIONS: GifOptions = { fps: 12, maxWidth: 640 };

function gifOpts(o: Partial<GifOptions>): GifOptions {
  const clamp = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : def;
  return {
    fps: clamp(o.fps, 1, GIF_MAX_FPS, DEFAULT_GIF_OPTIONS.fps),
    maxWidth: clamp(o.maxWidth, 16, GIF_MAX_WIDTH, DEFAULT_GIF_OPTIONS.maxWidth),
  };
}

/** Shared by both GIF passes: capped frame rate, width capped without upscaling (height keeps aspect, even). */
function gifScaleFilter(o: GifOptions): string {
  // Orientation-aware cap: landscape keeps maxWidth, portrait (mobile) gets 9/16 of it.
  const portrait = Math.max(16, Math.floor((o.maxWidth * 9) / 32) * 2);
  return `fps=${o.fps},scale=w=if(gt(iw\\,ih)\\,min(${o.maxWidth}\\,iw)\\,min(${portrait}\\,iw)):h=-2:flags=lanczos`;
}

/** GIF pass 1: derive an optimal 256-colour palette from the whole clip. */
export function buildGifPaletteArgs(input: string, palette: string, opts: Partial<GifOptions> = {}): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-vf', `${gifScaleFilter(gifOpts(opts))},palettegen=stats_mode=diff`,
    palette,
  ];
}

/** GIF pass 2: encode with that palette (palette is a second input, never part of a filter string). */
export function buildGifArgs(input: string, palette: string, output: string, opts: Partial<GifOptions> = {}): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-i', palette,
    '-lavfi', `${gifScaleFilter(gifOpts(opts))}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    '-an', '-loop', '0',
    output,
  ];
}

export function parseFfmpegVersion(stdout: string): string | null {
  const m = /ffmpeg version\s+(\S+)/i.exec(stdout);
  return m ? m[1] : null;
}

export function detectFfmpeg(spawnFn: SpawnFn = spawn, bin = 'ffmpeg'): Promise<FfmpegStatus> {
  return new Promise((resolve) => {
    const none: FfmpegStatus = { available: false, version: null };
    let done = false;
    let out = '';
    const finish = (r: FfmpegStatus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<SpawnFn>;
    const timer = setTimeout(() => {
      try { child?.kill(); } catch { /* ignore */ }
      finish(none);
    }, 5000);
    try {
      child = spawnFn(bin, ['-version'], { windowsHide: true });
    } catch {
      finish(none);
      return;
    }
    child.stdout?.on('data', (d: Buffer | string) => { out += d.toString(); });
    child.on('error', () => finish(none));
    child.on('close', (code: number | null) => {
      const version = parseFfmpegVersion(out);
      finish(code === 0 && version ? { available: true, version } : none);
    });
  });
}

/** Generous per-run limit: a stuck ffmpeg must not hang an export (or the app) forever. */
export const FFMPEG_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** How long a killed ffmpeg gets to report `close` before we give up waiting for it. */
const KILL_GRACE_MS = 2000;

interface LiveRun { stop(reason: string): Promise<void> }
const liveRuns = new Set<LiveRun>();

/** Kill every running conversion and wait (briefly) until their partial outputs are removed. Used on app quit. */
export function killAllFfmpeg(): Promise<void> {
  return Promise.all([...liveRuns].map((r) => r.stop('ffmpeg was cancelled: the app is quitting'))).then(() => undefined);
}

/**
 * Run ffmpeg to completion. On timeout or killAllFfmpeg the process is killed and the files in `cleanup`
 * (its outputs) are deleted before the promise rejects.
 */
function runFfmpeg(
  args: string[], spawnFn: SpawnFn, bin: string, timeoutMs = FFMPEG_TIMEOUT_MS, cleanup: string[] = [],
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    let reason: string | null = null;
    let child: ReturnType<SpawnFn>;
    try {
      child = spawnFn(bin, args, { windowsHide: true });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    let markClosed: () => void = () => undefined;
    const closed = new Promise<void>((r) => { markClosed = r; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const run: LiveRun = { stop };

    const end = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      liveRuns.delete(run);
      fn();
      markClosed();
    };
    const killed = async () => {
      await Promise.all(cleanup.map((p) => fsp.rm(p, { force: true }).catch(() => undefined)));
      end(() => reject(new Error(reason ?? 'ffmpeg was stopped')));
    };
    function stop(why: string): Promise<void> {
      if (settled) return closed;
      reason ??= why;
      try { child.kill(); } catch { /* already gone */ }
      grace ??= setTimeout(() => { void killed(); }, KILL_GRACE_MS);
      return closed;
    }

    liveRuns.add(run);
    timer = setTimeout(() => { void stop(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)} s`); }, timeoutMs);
    child.stderr?.on('data', (d: Buffer | string) => { stderr = (stderr + d.toString()).slice(-2000); });
    child.on('error', (e: Error) => end(() => reject(e)));
    child.on('close', (code: number | null) => {
      if (reason !== null) { void killed(); return; }
      end(() => {
        if (code === 0) resolve();
        else reject(new Error(stderr.slice(-500) || `ffmpeg exited with code ${code}`));
      });
    });
  });
}

export function convertToMp4(
  input: string, output: string, spawnFn: SpawnFn = spawn, bin = 'ffmpeg', timeoutMs = FFMPEG_TIMEOUT_MS,
): Promise<void> {
  return runFfmpeg(buildMp4Args(input, output), spawnFn, bin, timeoutMs, [output]);
}

/** Re-encode [start, end] (seconds, already validated) of `input` to MP4. */
export function trimToMp4(
  input: string, output: string, start: number, end: number,
  spawnFn: SpawnFn = spawn, bin = 'ffmpeg', timeoutMs = FFMPEG_TIMEOUT_MS,
): Promise<void> {
  return runFfmpeg(buildMp4Args(input, output, { start, end }), spawnFn, bin, timeoutMs, [output]);
}

/** Two-pass GIF (palettegen, then paletteuse); the palette lives in a private temp dir removed afterwards. */
export async function convertToGif(
  input: string, output: string, opts: Partial<GifOptions> = {}, spawnFn: SpawnFn = spawn, bin = 'ffmpeg',
  timeoutMs = FFMPEG_TIMEOUT_MS,
): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'screen-recorder-gif-'));
  try {
    const palette = path.join(dir, 'palette.png');
    await runFfmpeg(buildGifPaletteArgs(input, palette, opts), spawnFn, bin, timeoutMs, [palette]);
    await runFfmpeg(buildGifArgs(input, palette, output, opts), spawnFn, bin, timeoutMs, [output]);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
