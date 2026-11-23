import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn() } }));

import { withExtension } from '../src/main/export';

describe('withExtension', () => {
  it('keeps a matching extension and swaps a different one', () => {
    expect(withExtension('C:\\v\\clip.MP4', 'mp4')).toBe('C:\\v\\clip.MP4');
    expect(withExtension('C:\\v\\clip.webm', 'gif')).toBe('C:\\v\\clip.gif');
  });
  it('does not eat a dotted directory when the file has no extension', () => {
    expect(withExtension('C:\\my.videos\\clip', 'mp4')).toBe('C:\\my.videos\\clip.mp4');
    expect(withExtension('/home/me.v2/clip', 'gif')).toBe('/home/me.v2/clip.gif');
  });
});
