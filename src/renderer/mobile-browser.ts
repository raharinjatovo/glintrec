import type { BarState } from '../shared/mobile-browser';

declare global {
  interface Window {
    mobileBrowserApi: { send(cmd: unknown): void; onState(cb: (s: BarState) => void): void };
  }
}

const api = window.mobileBrowserApi;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const address = $<HTMLInputElement>('address');
const back = $<HTMLButtonElement>('back');
const forward = $<HTMLButtonElement>('forward');
const reload = $<HTMLButtonElement>('reload');
const notice = $('notice');

back.onclick = () => api.send({ type: 'back' });
forward.onclick = () => api.send({ type: 'forward' });
reload.onclick = () => api.send({ type: 'reload' });
$('home').onclick = () => api.send({ type: 'home' });
address.onkeydown = (e) => {
  if (e.key === 'Enter') { api.send({ type: 'navigate', text: address.value }); address.blur(); }
};
address.onfocus = () => address.select();

api.onState((s) => {
  back.disabled = !s.canGoBack;
  forward.disabled = !s.canGoForward;
  reload.textContent = s.loading ? '\u2022' : '\u21BB';
  if (document.activeElement !== address) address.value = s.url;
  notice.textContent = s.notice;
  notice.hidden = s.notice === '';
});
