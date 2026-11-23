import type { HookLike, HookLoad } from './input-session';

let cached: HookLoad | null = null;

/**
 * Loads the native uiohook-napi module on first use only (never at startup, never while idle). It is a
 * prebuilt N-API addon kept external by the build; if it cannot load, the app runs with the hook-based
 * features off and the returned error says why. The result, including a failure, is cached.
 */
export function loadUiohook(): HookLoad {
  if (cached) return cached;
  try {
    const mod = require('uiohook-napi') as { uIOhook?: HookLike };
    cached = mod.uIOhook ? { hook: mod.uIOhook, error: null } : { hook: null, error: 'uiohook-napi has no uIOhook export' };
  } catch (e) {
    cached = { hook: null, error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
  return cached;
}
