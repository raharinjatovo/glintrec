import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import type { Settings } from '../shared/ipc';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../shared/settings';

export interface FsLike {
  readFile(p: string, enc: 'utf8'): Promise<string>;
  writeFile(p: string, data: string, enc: 'utf8'): Promise<void>;
  rename(a: string, b: string): Promise<void>;
  mkdir(p: string, o: { recursive: true }): Promise<unknown>;
}

export class SettingsStore {
  private cache: Settings = sanitizeSettings(DEFAULT_SETTINGS);

  constructor(
    private readonly filePath: string,
    private readonly fs: FsLike = nodeFs,
  ) {}

  async load(): Promise<Settings> {
    try {
      const text = await this.fs.readFile(this.filePath, 'utf8');
      this.cache = sanitizeSettings(JSON.parse(text));
    } catch {
      this.cache = sanitizeSettings(DEFAULT_SETTINGS);
    }
    return this.cache;
  }

  async save(next: Settings): Promise<Settings> {
    const clean = sanitizeSettings(next);
    const tmp = this.filePath + '.tmp';
    await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.fs.writeFile(tmp, JSON.stringify(clean, null, 2), 'utf8');
    await this.fs.rename(tmp, this.filePath);
    this.cache = clean;
    return clean;
  }

  get(): Settings {
    return this.cache;
  }
}
