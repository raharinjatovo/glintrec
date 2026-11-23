import { contextBridge, ipcRenderer } from 'electron';
import { CONTROL_HUD_COMMAND_CHANNEL, CONTROL_HUD_VIEW_EVENT, type ControlHudView } from '../shared/control-hud';

// Only the floating control toolbar page gets this: fixed-vocabulary commands out, validated view in.
contextBridge.exposeInMainWorld('controlHudApi', {
  send: (cmd: 'pause-toggle' | 'switch-mode' | 'stop') => { console.log('[control-hud] preload sending', cmd); ipcRenderer.send(CONTROL_HUD_COMMAND_CHANNEL, cmd); },
  onState: (cb: (v: ControlHudView) => void) => {
    ipcRenderer.on(CONTROL_HUD_VIEW_EVENT, (_e, v: ControlHudView) => cb(v));
  },
});
