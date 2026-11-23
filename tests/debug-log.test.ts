import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEBUG_LOG_MAX_BYTES, debugLog, formatLogLine, initDebugLog, resetDebugLog } from '../src/main/debug-log';

describe('debug log', () => {
  afterEach(() => resetDebugLog());

  it('formats a timestamped line', () => {
    expect(formatLogLine(new Date('2026-01-02T03:04:05.000Z'), ['[control-hud] x', { a: 1 }, new Error('boom')]))
      .toBe('2026-01-02T03:04:05.000Z [control-hud] x {"a":1} boom\n');
  });

  it('truncates at init, appends, and stops at the size cap', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-')), 'control-hud.log');
    fs.writeFileSync(f, 'old content');
    initDebugLog(f);
    debugLog('[control-hud] hello');
    const text = fs.readFileSync(f, 'utf8');
    expect(text).not.toContain('old content');
    expect(text).toContain('[control-hud] hello');
    debugLog('x'.repeat(DEBUG_LOG_MAX_BYTES));
    const size = fs.statSync(f).size;
    debugLog('dropped');
    expect(fs.statSync(f).size).toBe(size);
  });

  it('does not throw on an unwritable path', () => {
    expect(() => { initDebugLog(path.join(os.tmpdir(), 'no-such-dir-xyz', 'a.log')); debugLog('x'); }).not.toThrow();
  });
});
