import type { HotkeyAction, HotkeyFailure, HotkeySettings, HotkeyStatus } from '../shared/ipc';
import { HOTKEY_ACTIONS, validateAccelerator } from '../shared/hotkeys';

/** The slice of Electron's globalShortcut we use (lets tests pass a fake). */
export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface HotkeyManager {
  /** Replace all registrations with `hotkeys`; never throws, failures are reported in the result. */
  apply(hotkeys: HotkeySettings): HotkeyStatus;
  status(): HotkeyStatus;
  dispose(): void;
}

export function createHotkeyManager(gs: GlobalShortcutLike, onAction: (action: HotkeyAction) => void): HotkeyManager {
  let held: string[] = [];
  let last: HotkeyStatus = { registered: [], failed: [] };

  const release = () => {
    for (const acc of held) {
      try { gs.unregister(acc); } catch { /* already gone */ }
    }
    held = [];
  };

  return {
    apply(hotkeys) {
      release();
      const registered: HotkeyAction[] = [];
      const failed: HotkeyFailure[] = [];
      for (const action of HOTKEY_ACTIONS) {
        const accelerator = validateAccelerator(hotkeys[action]);
        if (!accelerator) {
          if (hotkeys[action]) failed.push({ action, accelerator: String(hotkeys[action]), reason: 'invalid shortcut' });
          continue;
        }
        if (held.includes(accelerator)) {
          failed.push({ action, accelerator, reason: 'already used by another action' });
          continue;
        }
        try {
          if (gs.register(accelerator, () => onAction(action))) {
            held.push(accelerator);
            registered.push(action);
          } else {
            failed.push({ action, accelerator, reason: 'already in use by another application' });
          }
        } catch (e) {
          failed.push({ action, accelerator, reason: e instanceof Error ? e.message : 'registration failed' });
        }
      }
      last = { registered, failed };
      return last;
    },
    status: () => last,
    dispose() {
      release();
      last = { registered: [], failed: [] };
    },
  };
}
