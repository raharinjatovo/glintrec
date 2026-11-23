import { contextBridge, ipcRenderer } from 'electron';
import { MOBILE_BROWSER_CHANNELS, MOBILE_BROWSER_STATE_EVENT, type BarState } from '../shared/mobile-browser';

// Only the mobile browser's bar page gets this: the main process validates every command and checks the sender.
contextBridge.exposeInMainWorld('mobileBrowserApi', {
  send: (cmd: unknown) => { ipcRenderer.send(MOBILE_BROWSER_CHANNELS.command, cmd); },
  onState: (cb: (s: BarState) => void) => {
    ipcRenderer.on(MOBILE_BROWSER_STATE_EVENT, (_e, s: BarState) => cb(s));
  },
});
