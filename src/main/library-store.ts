import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import type { LibraryItem } from '../shared/ipc';
import { MAX_LIBRARY_ENTRIES, sanitizeLibrary, toLibraryItems, type LibraryEntry } from '../shared/library';
import type { FsLike } from './settings-store';

export type StatFn = (p: string) => Promise<{ size: number; isFile(): boolean }>;

/** JSON index of saved recordings in userData, written atomically (tmp + rename) like the settings. */
export class LibraryStore {
  private entries: LibraryEntry[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly fs: FsLike = nodeFs,
    private readonly stat: StatFn = nodeFs.stat,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    try {
      this.entries = sanitizeLibrary(JSON.parse(await this.fs.readFile(this.filePath, 'utf8')));
    } catch {
      this.entries = [];
    }
  }

  /** Main-process lookup by id; the path never goes to the renderer. */
  get(id: string): LibraryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Index a saved file (an existing entry for the same path is refreshed, keeping its id). */
  async add(filePath: string, size: number, durationSec: number | null): Promise<LibraryEntry> {
    const key = filePath.toLowerCase();
    const prev = this.entries.find((e) => e.path.toLowerCase() === key);
    const entry: LibraryEntry = {
      id: prev?.id ?? randomBytes(8).toString('hex'),
      path: filePath,
      name: path.basename(filePath),
      size: Math.max(0, Math.round(size)),
      durationSec,
      createdAt: this.now(),
    };
    // Round-trip through the sanitizer so a bad path (wrong extension, relative) is never indexed.
    const next = sanitizeLibrary([entry, ...this.entries.filter((e) => e !== prev)]);
    if (!next.some((e) => e.id === entry.id)) throw new Error('Recording path cannot be indexed');
    this.entries = next;
    await this.persist();
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    const next = this.entries.filter((e) => e.id !== id);
    if (next.length === this.entries.length) return false;
    this.entries = next;
    await this.persist();
    return true;
  }

  /** Entries for the UI; files that no longer exist are flagged `missing` (not dropped: the user may remove them). */
  async list(): Promise<LibraryItem[]> {
    const stats = new Map<string, number>();
    await Promise.all(this.entries.map(async (e) => {
      try {
        const st = await this.stat(e.path);
        if (st.isFile()) stats.set(e.id, st.size);
      } catch { /* missing */ }
    }));
    return toLibraryItems(this.entries, stats);
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, entries: this.entries.slice(0, MAX_LIBRARY_ENTRIES) }, null, 2);
    const tmp = this.filePath + '.tmp';
    const write = this.writing.catch(() => undefined).then(async () => {
      await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await this.fs.writeFile(tmp, snapshot, 'utf8');
      await this.fs.rename(tmp, this.filePath);
    });
    this.writing = write;
    return write;
  }
}
