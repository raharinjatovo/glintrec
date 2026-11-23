/** Floating control toolbar page: renders the validated view from main, sends fixed-vocabulary commands back. */
interface ControlHudPageView { paused: boolean; pauseLabel: string; modeLabel: string; stopLabel: string; canSwitch: boolean }
declare global {
  interface Window {
    controlHudApi?: {
      send(cmd: 'pause-toggle' | 'switch-mode' | 'stop'): void;
      onState(cb: (v: ControlHudPageView) => void): void;
    };
  }
}

const PLAY = 'M2 1l9 5-9 5z';
const PAUSE = 'M2 1h3v10H2zM7 1h3v10H7z';
const $ = (id: string) => document.getElementById(id)!;
const pause = $('pause');
const api = window.controlHudApi;

console.log('[control-hud] page script running; preload api', api ? 'present' : 'MISSING');
const fire = (cmd: 'pause-toggle' | 'switch-mode' | 'stop') => () => {
  console.log('[control-hud] click', cmd, api ? '' : '(no api: preload not loaded)');
  api?.send(cmd);
};
pause.onclick = fire('pause-toggle');
($('mode') as HTMLButtonElement).onclick = fire('switch-mode');
$('stop').onclick = fire('stop');

api?.onState((v) => {
  if (!v || typeof v.pauseLabel !== 'string' || typeof v.modeLabel !== 'string') return;
  pause.dataset.paused = v.paused ? 'true' : 'false';
  $('pause-label').textContent = v.pauseLabel;
  $('pause-icon').firstElementChild!.setAttribute('d', v.paused ? PLAY : PAUSE);
  $('mode-label').textContent = v.modeLabel;
  $('stop-label').textContent = typeof v.stopLabel === 'string' ? v.stopLabel : 'Arrêter';
  const m = $('mode') as HTMLButtonElement;
  m.disabled = v.canSwitch !== true;
  m.title = v.canSwitch ? 'Changer de mode' : 'Changement impossible pour le moment';
});

export {};
