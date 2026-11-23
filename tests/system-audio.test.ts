import { describe, expect, it } from 'vitest';
import { createSilenceWatch, pickAudioHostSource, systemAudioAction, wantsSystemAudio } from '../src/shared/system-audio';

describe('wantsSystemAudio', () => {
  it('needs the option on and not video-only', () => {
    expect(wantsSystemAudio({ systemAudioEnabled: true, videoOnly: false })).toBe(true);
    expect(wantsSystemAudio({ systemAudioEnabled: false, videoOnly: false })).toBe(false);
    expect(wantsSystemAudio({ systemAudioEnabled: true, videoOnly: true })).toBe(false);
  });
});

describe('systemAudioAction', () => {
  it('opens and closes only while idle', () => {
    expect(systemAudioAction(true, false, 'idle')).toBe('open');
    expect(systemAudioAction(false, true, 'idle')).toBe('close');
    expect(systemAudioAction(true, true, 'idle')).toBe('keep');
    expect(systemAudioAction(false, false, 'idle')).toBe('keep');
  });
  it('never touches the capture during a recording', () => {
    for (const p of ['countdown', 'recording', 'paused', 'stopping']) {
      expect(systemAudioAction(true, false, p)).toBe('keep');
      expect(systemAudioAction(false, true, p)).toBe('keep');
    }
  });
});

describe('pickAudioHostSource', () => {
  const ids = ['window:1:0', 'screen:0:0', 'screen:1:0'];
  it('prefers the selected source when it still exists', () => {
    expect(pickAudioHostSource('window:1:0', ids)).toBe('window:1:0');
  });
  it('falls back to the first screen, then any source', () => {
    expect(pickAudioHostSource('screen:9:0', ids)).toBe('screen:0:0');
    expect(pickAudioHostSource(null, ['window:2:0'])).toBe('window:2:0');
    expect(pickAudioHostSource(null, [])).toBeNull();
  });
});

describe('createSilenceWatch', () => {
  it('reports silence once after the limit, then sound once when it returns', () => {
    const w = createSilenceWatch(1000);
    expect(w(0, 0)).toBeNull();
    expect(w(0, 999)).toBeNull();
    expect(w(0, 1000)).toBe('silent');
    expect(w(0, 5000)).toBeNull();
    expect(w(0.2, 5100)).toBe('sound');
    expect(w(0.2, 5200)).toBeNull();
  });
  it('restarts the clock whenever sound is heard', () => {
    const w = createSilenceWatch(1000);
    w(0, 0);
    expect(w(0.1, 900)).toBeNull();
    expect(w(0, 1000)).toBeNull();
    expect(w(0, 1900)).toBeNull();
    expect(w(0, 2000)).toBe('silent');
  });
});
