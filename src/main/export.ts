import { dialog, type BrowserWindow } from 'electron';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { ExportFormat, ExportResult } from '../shared/ipc';
import { convertToGif, convertToMp4, detectFfmpeg } from './ffmpeg';

const FILTER_NAME: Record<ExportFormat, string> = { mp4: 'MP4 video', gif: 'Animated GIF' };

/** Force `ext` on `p`; the old extension is only stripped from the file name, never from a dotted directory. */
export function withExtension(p: string, ext: string): string {
  return p.toLowerCase().endsWith('.' + ext) ? p : p.replace(/\.[^\\/.]*$/, '') + '.' + ext;
}

/**
 * Convert an already saved recording to MP4 or GIF. `input` always comes from the main process (the
 * last saved recording), never from the renderer. Output is written to a sibling partial file and
 * renamed on success, so a failed conversion cannot clobber a file the user chose to overwrite.
 */
export async function exportRecording(win: BrowserWindow | null, input: string | null, format: ExportFormat): Promise<ExportResult> {
  if (!input) return { status: 'error', message: 'No saved recording to export yet' };
  try {
    if (!(await fsp.stat(input)).isFile()) throw new Error('not a file');
  } catch {
    return { status: 'error', message: 'The saved recording is no longer available' };
  }
  if (!(await detectFfmpeg()).available) return { status: 'error', message: 'ffmpeg is not available' };

  const parsed = path.parse(input);
  const opts = {
    title: format === 'gif' ? 'Export GIF' : 'Export MP4',
    defaultPath: path.join(parsed.dir, `${parsed.name}.${format}`),
    filters: [{ name: FILTER_NAME[format], extensions: [format] }],
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return { status: 'cancelled' };
  const target = withExtension(res.filePath, format);
  if (path.resolve(target).toLowerCase() === path.resolve(input).toLowerCase()) {
    return { status: 'error', message: 'Choose a different file name than the source recording' };
  }

  const tp = path.parse(target);
  const partial = path.join(tp.dir, `${tp.name}.partial-${process.pid}${tp.ext}`);
  try {
    if (format === 'gif') await convertToGif(input, partial);
    else await convertToMp4(input, partial);
    await fsp.rename(partial, target);
    return { status: 'saved', path: target, format };
  } catch (err) {
    await fsp.rm(partial, { force: true }).catch(() => undefined);
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
