import { createWriteStream, type WriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

interface Session { filePath: string; stream: WriteStream; closed: boolean }

export class RecordingWriters {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly tempDir: string) {}

  async begin(): Promise<{ sessionId: string; filePath: string }> {
    await fsp.mkdir(this.tempDir, { recursive: true });
    const sessionId = randomUUID();
    const filePath = path.join(this.tempDir, `rec-${sessionId}.webm`);
    const stream = createWriteStream(filePath);
    stream.on('error', () => { /* surfaced via write()/close() */ });
    this.sessions.set(sessionId, { filePath, stream, closed: false });
    return { sessionId, filePath };
  }

  /** A recording is still being captured: begun, not finalized (a finalized session only awaits save/retry/discard). */
  hasActive(): boolean {
    for (const s of this.sessions.values()) if (!s.closed) return true;
    return false;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  write(sessionId: string, chunk: Uint8Array): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return Promise.reject(new Error('Unknown recording session'));
    if (s.closed) return Promise.reject(new Error('Recording session is closed'));
    return new Promise((resolve, reject) => {
      s.stream.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** End the stream but keep the session and file, so a failed or cancelled save can be retried. */
  async finalize(sessionId: string): Promise<string> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('Unknown recording session');
    await this.endStream(s);
    return s.filePath;
  }

  /** End the stream and forget the session; the file is left for the caller. */
  async close(sessionId: string): Promise<string> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('Unknown recording session');
    this.sessions.delete(sessionId);
    await this.endStream(s);
    return s.filePath;
  }

  /** Drop the session (ended or not) and delete its temp file. No-op for unknown sessions. */
  async abort(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    await this.endStream(s).catch(() => undefined);
    await this.remove(s.filePath).catch(() => undefined);
  }

  /** End every open stream and delete every temp file (app quit, window closed, renderer gone). */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.abort(id)));
  }

  private async endStream(s: Session): Promise<void> {
    if (s.closed) return;
    s.closed = true;
    await new Promise<void>((resolve, reject) => {
      s.stream.once('error', reject);
      s.stream.end(() => resolve());
    });
  }

  async remove(filePath: string): Promise<void> {
    await fsp.rm(filePath, { force: true });
  }
}
