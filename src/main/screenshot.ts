import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { screenshotName } from '../shared/format';

export const MAX_SCREENSHOT_BYTES = 64 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength > PNG_MAGIC.length && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/** Accepts the IPC payload (ArrayBuffer or typed array) and returns validated PNG bytes; throws otherwise. */
export function toPngBytes(raw: unknown): Uint8Array {
  let u8: Uint8Array;
  if (raw instanceof ArrayBuffer) u8 = new Uint8Array(raw);
  else if (ArrayBuffer.isView(raw)) u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  else throw new Error('Bad screenshot');
  if (u8.byteLength > MAX_SCREENSHOT_BYTES) throw new Error('Screenshot too large');
  if (!isPng(u8)) throw new Error('Screenshot is not a PNG');
  return u8;
}

/** Write `png` into `dir` as screenshot-<timestamp>.png, never overwriting: "name (1).png", "name (2).png", ... */
export async function writeScreenshot(dir: string, png: Uint8Array, now: Date = new Date()): Promise<string> {
  await fsp.mkdir(dir, { recursive: true });
  const base = path.join(dir, screenshotName(now));
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? `${base}.png` : `${base} (${i}).png`;
    try {
      await fsp.writeFile(candidate, png, { flag: 'wx' });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free file name');
}
