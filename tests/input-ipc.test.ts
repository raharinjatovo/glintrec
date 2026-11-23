import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...a: any[]) => Promise<any>>();
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: any[]) => Promise<any>) => handlers.set(ch, fn) },
}));

import { registerInputIpc } from '../src/main/input-ipc';
import { IPC } from '../src/shared/ipc';

const wc = {};
const good = { sender: wc } as any;
const bad = { sender: {} } as any;
const assertSender = (e: any) => { if (e.sender !== wc) throw new Error('Untrusted sender'); };
const call = (ch: string, e: any, ...a: any[]) => handlers.get(ch)!(e, ...a);

function setup(over: { session?: any; isRecording?: () => boolean } = {}) {
  handlers.clear();
  const session = over.session ?? { start: vi.fn(async () => ({ hookAvailable: true, display: null, message: '' })), stop: vi.fn(), active: () => false };
  registerInputIpc({ assertSender, session, isRecording: over.isRecording });
  return session;
}

describe('input IPC', () => {
  beforeEach(() => handlers.clear());

  it('rejects untrusted senders before doing anything', async () => {
    const session = setup();
    await expect(call(IPC.inputStart, bad, { cursor: true, clicks: true, keys: true })).rejects.toThrow('Untrusted sender');
    await expect(call(IPC.inputStop, bad)).rejects.toThrow('Untrusted sender');
    expect(session.start).not.toHaveBeenCalled();
    expect(session.stop).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined], [7], ['keys'], [[true]]])('rejects malformed request %j without starting the hook', async (raw) => {
    const session = setup();
    const res = await call(IPC.inputStart, good, raw);
    expect(res).toEqual({ hookAvailable: false, display: null, message: 'Invalid input request.' });
    expect(session.start).not.toHaveBeenCalled();
  });

  it('passes only strict booleans on to the session', async () => {
    const session = setup();
    await call(IPC.inputStart, good, { cursor: 1, clicks: 'yes', keys: true, extra: 'x' });
    expect(session.start).toHaveBeenCalledWith({ cursor: false, clicks: false, keys: true });
  });

  it('refuses to start outside a recording', async () => {
    const session = setup({ isRecording: () => false });
    const res = await call(IPC.inputStart, good, { cursor: true, clicks: false, keys: false });
    expect(res.message).toMatch(/only runs while recording/);
    expect(session.start).not.toHaveBeenCalled();
  });

  it('starts during a recording and stops on request', async () => {
    const session = setup({ isRecording: () => true });
    await call(IPC.inputStart, good, { cursor: true, clicks: true, keys: false });
    expect(session.start).toHaveBeenCalledWith({ cursor: true, clicks: true, keys: false });
    await call(IPC.inputStop, good);
    expect(session.stop).toHaveBeenCalledTimes(1);
  });

  it('works (as unavailable) when no session exists', async () => {
    handlers.clear();
    registerInputIpc({ assertSender });
    expect((await call(IPC.inputStart, good, { cursor: true, clicks: false, keys: false })).hookAvailable).toBe(false);
    await expect(call(IPC.inputStop, good)).resolves.toBeUndefined();
  });
});
