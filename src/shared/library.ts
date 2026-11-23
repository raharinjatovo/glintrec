import type { LibraryItem } from './ipc';

/** One saved recording in the on-disk index (main process only: it carries the real path). */
export interface LibraryEntry {
  id: string;
  path: string;
  name: string;
  size: number;
  durationSec: number | null;
  /** Epoch ms. */
  createdAt: number;
}

export const MAX_LIBRARY_ENTRIES = 200;
const MAX_PATH_LEN = 1024;
const MAX_NAME_LEN = 255;
/** Only media files may be indexed: the path is later handed to shell.openPath. */
const MEDIA_EXT = /\.(mp4|webm|gif)$/i;
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

export const LIBRARY_ID = /^[0-9a-f]{16}$/;
export const isLibraryId = (v: unknown): v is string => typeof v === 'string' && LIBRARY_ID.test(v);

export const isLibraryPath = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_PATH_LEN && !v.includes('\0')
  && ABSOLUTE.test(v) && MEDIA_EXT.test(v);

const baseName = (p: string) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1);
const finiteOr = (v: unknown, lo: number, hi: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;

function sanitizeEntry(raw: unknown): LibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isLibraryId(r.id) || !isLibraryPath(r.path)) return null;
  const name = typeof r.name === 'string' && r.name.length > 0 && r.name.length <= MAX_NAME_LEN && !/[\0\\/]/.test(r.name)
    ? r.name : baseName(r.path);
  const dur = typeof r.durationSec === 'number' && Number.isFinite(r.durationSec) && r.durationSec > 0 && r.durationSec <= 1e6
    ? r.durationSec : null;
  return {
    id: r.id, path: r.path, name,
    size: Math.round(finiteOr(r.size, 0, Number.MAX_SAFE_INTEGER, 0)),
    durationSec: dur,
    createdAt: Math.round(finiteOr(r.createdAt, 0, 8.64e15, 0)),
  };
}

/** Parse untrusted index JSON: drops malformed/duplicate entries, sorts newest first, caps the length. */
export function sanitizeLibrary(raw: unknown): LibraryEntry[] {
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? (raw as { entries?: unknown }).entries : null);
  if (!Array.isArray(list)) return [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const out: LibraryEntry[] = [];
  for (const item of list) {
    const e = sanitizeEntry(item);
    if (!e) continue;
    const key = e.path.toLowerCase();
    if (ids.has(e.id) || paths.has(key)) continue;
    ids.add(e.id);
    paths.add(key);
    out.push(e);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, MAX_LIBRARY_ENTRIES);
}

/** Renderer view of the index: no paths; `stats` maps id -> current size, a missing key means the file is gone. */
export function toLibraryItems(entries: LibraryEntry[], stats: ReadonlyMap<string, number>): LibraryItem[] {
  return entries.map((e) => {
    const size = stats.get(e.id);
    return {
      id: e.id, name: e.name, size: size ?? e.size, durationSec: e.durationSec, createdAt: e.createdAt,
      missing: size === undefined,
    };
  });
}
