import { describe, expect, it } from 'vitest';
import { getSelectedSource, isValidSourceId, setSelectedSource } from '../src/main/capture-selection';

describe('capture-selection', () => {
  it('accepts screen and window ids', () => {
    expect(isValidSourceId('screen:0:0')).toBe(true);
    expect(isValidSourceId('window:3016262:0')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'screen', 'screen:a:0', 'tab:1:0', 'screen:0:0;x', '../screen:0:0', null, undefined, 42, {}]) {
      expect(isValidSourceId(bad)).toBe(false);
    }
  });

  it('stores a valid id and throws on an invalid one without changing the selection', () => {
    setSelectedSource('window:12:0');
    expect(getSelectedSource()).toBe('window:12:0');
    expect(() => setSelectedSource('nope')).toThrow('Invalid capture source id');
    expect(getSelectedSource()).toBe('window:12:0');
  });
});
