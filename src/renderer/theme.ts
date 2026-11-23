import type { Settings, ThemePref } from '../shared/ipc';
import { nextTheme } from '../shared/theme';

/** Sets/removes data-theme on <html>; 'system' leaves it to the prefers-color-scheme media query. */
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

function systemPrefersLight(mq: MediaQueryList): boolean {
  return mq.matches;
}

/** Wires the top-bar toggle; `onChange` is called after an explicit user choice (to persist it). */
export function bindThemeToggle(button: HTMLButtonElement, settings: Settings, onChange: () => void): void {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const render = () => {
    applyTheme(settings.theme);
    const target = nextTheme(settings.theme, systemPrefersLight(mq));
    const label = target === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    button.dataset.target = target;
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  button.addEventListener('click', () => {
    settings.theme = nextTheme(settings.theme, systemPrefersLight(mq));
    render();
    onChange();
  });
  mq.addEventListener('change', () => { if (settings.theme === 'system') render(); });
  render();
}
