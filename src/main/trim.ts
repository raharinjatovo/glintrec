import { constants as fsConstants } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { trimmedFileName } from '../shared/trim';
import { trimToMp4 } from './ffmpeg';

type TrimRun = (input: string, output: string, start: number, end: number) => Promise<void>;

/** Copy `src` to `dir/fileName`, never overwriting: on a clash use "name (1).ext", "name (2).ext", ... */
async function copyToFreeName(src: string, dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  for (let i = 0; i < 1000; i++) {
    const candidate = path.join(dir, i === 0 ? fileName : `${base} (${i})${ext}`);
    try {
      await fsp.copyFile(src, candidate, fsConstants.COPYFILE_EXCL);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free file name');
}

/**
 * Write a re-encoded MP4 copy of [start, end] of `input` next to it as "<name>-trim.mp4" (or "(n)").
 * The range must already be validated (validateTrim). ffmpeg writes to a sibling partial file that is
 * copied to a free name only on success, so an existing file is never overwritten and failures leave nothing.
 */
export async function trimRecording(
  input: string, start: number, end: number, run: TrimRun = trimToMp4,
): Promise<string> {
  const parsed = path.parse(input);
  const partial = path.join(parsed.dir, `${parsed.name}.partial-${process.pid}-trim.mp4`);
  try {
    await run(input, partial, start, end);
    return await copyToFreeName(partial, parsed.dir, trimmedFileName(parsed.base));
  } finally {
    await fsp.rm(partial, { force: true }).catch(() => undefined);
  }
}
