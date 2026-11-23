import { describe, expect, it } from 'vitest';
import { buildDisplayMediaResponse } from '../src/main/capture-selection';
import { createInputSlot, hasLiveAudio, micGain } from '../src/shared/audio-mix';

const stream = (...states: string[]) => ({ getAudioTracks: () => states.map((readyState) => ({ readyState })) });

describe('micGain', () => {
  it('mutes with 0 and passes with 1', () => {
    expect(micGain(true)).toBe(1);
    expect(micGain(false)).toBe(0);
  });
});

describe('hasLiveAudio', () => {
  it('needs a non-ended audio track', () => {
    expect(hasLiveAudio(null)).toBe(false);
    expect(hasLiveAudio(stream())).toBe(false);
    expect(hasLiveAudio(stream('ended'))).toBe(false);
    expect(hasLiveAudio(stream('ended', 'live'))).toBe(true);
  });
});

describe('createInputSlot', () => {
  const make = () => {
    const log: string[] = [];
    let n = 0;
    const slot = createInputSlot<ReturnType<typeof stream>, string>(
      () => { const id = `n${++n}`; log.push(`connect ${id}`); return id; },
      (id) => { log.push(`disconnect ${id}`); },
    );
    return { slot, log };
  };
  it('connects, replaces (disconnecting the old node first) and removes at any time', () => {
    const { slot, log } = make();
    slot.set(stream('live')); slot.set(stream('live')); slot.set(null);
    expect(log).toEqual(['connect n1', 'disconnect n1', 'connect n2', 'disconnect n2']);
    expect(slot.connected).toBe(false);
    expect(slot.stream).toBeNull();
  });
  it('same stream twice is a no-op; removing when empty is a no-op', () => {
    const { slot, log } = make();
    const a = stream('live');
    slot.set(null); slot.set(a); slot.set(a);
    expect(log).toEqual(['connect n1']);
  });
  it('stream without a live audio track is held but not connected', () => {
    const { slot, log } = make();
    slot.set(stream()); slot.set(stream('ended'));
    expect(log).toEqual([]);
    expect(slot.connected).toBe(false);
  });
  it('replacing a connected stream by one without audio disconnects', () => {
    const { slot, log } = make();
    slot.set(stream('live')); slot.set(stream());
    expect(log).toEqual(['connect n1', 'disconnect n1']);
    expect(slot.connected).toBe(false);
  });
});

describe('buildDisplayMediaResponse', () => {
  it('denies without a video source (even if audio was requested)', () => {
    expect(buildDisplayMediaResponse(undefined, true)).toEqual({});
    expect(buildDisplayMediaResponse(undefined, false)).toEqual({});
  });
  it('grants loopback only when audio was requested', () => {
    expect(buildDisplayMediaResponse({ id: 's' }, true)).toEqual({ video: { id: 's' }, audio: 'loopback' });
    expect(buildDisplayMediaResponse({ id: 's' }, false)).toEqual({ video: { id: 's' } });
  });
});
