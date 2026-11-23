import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import type { InputStartResult } from '../shared/ipc';
import { parseInputRequest } from '../shared/input-events';
import type { InputSession } from './input-session';

export interface InputIpcDeps {
  assertSender: (e: IpcMainInvokeEvent) => void;
  session?: InputSession;
  /** True while a recording session is open in the main process; the hook never starts without one. */
  isRecording?: () => boolean;
}

const unavailable = (message: string): InputStartResult => ({ hookAvailable: false, display: null, message });

export function registerInputIpc(deps: InputIpcDeps): void {
  const { assertSender, session } = deps;

  ipcMain.handle(IPC.inputStart, async (e, raw: unknown): Promise<InputStartResult> => {
    assertSender(e);
    const req = parseInputRequest(raw);
    if (!req) return unavailable('Invalid input request.');
    if (!session) return unavailable('Input tracking is not available.');
    if (deps.isRecording && !deps.isRecording()) return unavailable('Input tracking only runs while recording.');
    return session.start(req);
  });

  ipcMain.handle(IPC.inputStop, async (e) => {
    assertSender(e);
    session?.stop();
  });
}
