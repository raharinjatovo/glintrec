import { contextBridge, ipcRenderer } from 'electron';
import { ANNOTATION_CHANNELS } from '../shared/annotation-strokes';
import { ANNOTATION_CONTROL_CHANNEL, ANNOTATION_CONTROL_VIEW_EVENT, type ControlHudView } from '../shared/control-hud';

// Only the draw overlay page gets this: fire-and-forget stroke data. The main process validates every message
// and checks that it comes from the overlay window itself.
contextBridge.exposeInMainWorld('annotationApi', {
  sendStroke: (stroke: unknown) => { ipcRenderer.send(ANNOTATION_CHANNELS.stroke, stroke); },
  sendBar: (bar: unknown) => { ipcRenderer.send(ANNOTATION_CHANNELS.bar, bar); },
  sendClear: () => { ipcRenderer.send(ANNOTATION_CHANNELS.clear); },
  // In-overlay recording controls: whitelisted command out (re-validated in main), view in.
  sendControl: (cmd: 'pause-toggle' | 'switch-mode' | 'stop') => {
    if (cmd !== 'pause-toggle' && cmd !== 'switch-mode' && cmd !== 'stop') return;
    ipcRenderer.send(ANNOTATION_CONTROL_CHANNEL, cmd);
  },
  onControlView: (cb: (v: ControlHudView | null) => void) => {
    ipcRenderer.on(ANNOTATION_CONTROL_VIEW_EVENT, (_e, v: ControlHudView | null) => cb(v));
  },
});
