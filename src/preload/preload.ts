import { contextBridge, ipcRenderer } from 'electron';
import { ANNOTATION_EVENT } from '../shared/annotation-strokes';
import { CONTROL_HUD_RELAY_EVENT } from '../shared/control-hud';
import { IPC, IPC_EVENTS, type HotkeyAction, type HotkeyStatus, type InputEvent, type RecorderApi } from '../shared/ipc';

const api: RecorderApi = {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  selectCaptureSource: (id) => ipcRenderer.invoke(IPC.selectCaptureSource, id),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (s) => ipcRenderer.invoke(IPC.saveSettings, s),
  pickImage: () => ipcRenderer.invoke(IPC.pickImage),
  loadImage: (p) => ipcRenderer.invoke(IPC.loadImage, p),
  checkFfmpeg: () => ipcRenderer.invoke(IPC.checkFfmpeg),
  beginRecording: () => ipcRenderer.invoke(IPC.recBegin),
  writeChunk: (id, chunk) => ipcRenderer.invoke(IPC.recChunk, id, chunk),
  abortRecording: (id) => ipcRenderer.invoke(IPC.recAbort, id),
  finishRecording: (req) => ipcRenderer.invoke(IPC.recFinish, req),
  overlayShow: (cfg) => ipcRenderer.invoke(IPC.overlayShow, cfg),
  overlayUpdate: (cfg) => ipcRenderer.invoke(IPC.overlayUpdate, cfg),
  overlayHide: () => ipcRenderer.invoke(IPC.overlayHide),
  saveScreenshot: (png) => ipcRenderer.invoke(IPC.saveScreenshot, png),
  exportRecording: (req) => ipcRenderer.invoke(IPC.exportRecording, req),
  getHotkeyStatus: () => ipcRenderer.invoke(IPC.getHotkeyStatus),
  listLibrary: () => ipcRenderer.invoke(IPC.libraryList),
  openLibraryItem: (id) => ipcRenderer.invoke(IPC.libraryOpen, id),
  revealLibraryItem: (id) => ipcRenderer.invoke(IPC.libraryReveal, id),
  deleteLibraryItem: (id) => ipcRenderer.invoke(IPC.libraryDelete, id),
  exportLibraryItem: (id, format) => ipcRenderer.invoke(IPC.libraryExport, id, format),
  trimLibraryItem: (req) => ipcRenderer.invoke(IPC.libraryTrim, req),
  onHotkey: (cb) => {
    const h = (_e: unknown, action: HotkeyAction) => cb(action);
    ipcRenderer.on(IPC_EVENTS.hotkeyTriggered, h);
    return () => { ipcRenderer.removeListener(IPC_EVENTS.hotkeyTriggered, h); };
  },
  onHotkeyStatus: (cb) => {
    const h = (_e: unknown, status: HotkeyStatus) => cb(status);
    ipcRenderer.on(IPC_EVENTS.hotkeyStatus, h);
    return () => { ipcRenderer.removeListener(IPC_EVENTS.hotkeyStatus, h); };
  },
  inputStart: (req) => ipcRenderer.invoke(IPC.inputStart, req),
  inputStop: () => ipcRenderer.invoke(IPC.inputStop),
  zoomHudUpdate: (u) => ipcRenderer.invoke(IPC.zoomHudUpdate, u),
  controlHudState: (s) => ipcRenderer.invoke(IPC.controlHudState, s),
  onControlCommand: (cb) => {
    const h = (_e: unknown, cmd: string) => cb(cmd);
    ipcRenderer.on(CONTROL_HUD_RELAY_EVENT, h);
    return () => { ipcRenderer.removeListener(CONTROL_HUD_RELAY_EVENT, h); };
  },
  captureFrameUpdate: (r) => ipcRenderer.invoke(IPC.captureFrameUpdate, r),
  openMobileBrowser: () => ipcRenderer.invoke(IPC.openMobileBrowser),
  onInput: (cb) => {
    const h = (_e: unknown, ev: InputEvent) => cb(ev);
    ipcRenderer.on(IPC_EVENTS.inputEvent, h);
    return () => { ipcRenderer.removeListener(IPC_EVENTS.inputEvent, h); };
  },
  onOverlayMoved: (cb) => {
    const h = (_e: unknown, pos: { x: number; y: number }) => cb(pos);
    ipcRenderer.on(IPC_EVENTS.overlayMoved, h);
    return () => { ipcRenderer.removeListener(IPC_EVENTS.overlayMoved, h); };
  },
  onAnnotation: (cb) => {
    const h = (_e: unknown, ev: unknown) => cb(ev);
    ipcRenderer.on(ANNOTATION_EVENT, h);
    return () => { ipcRenderer.removeListener(ANNOTATION_EVENT, h); };
  },
};

contextBridge.exposeInMainWorld('recorderApi', api);
