/** Zoom indicator page: main pushes validated values through these two functions (no preload, no IPC here). */
interface ZoomHudPageView { text: string; label: string; mode: string; fraction: number }
declare global {
  interface Window {
    __setZoom?: (v: ZoomHudPageView) => void;
    __flash?: () => void;
  }
}

const MODES = ['none', 'manual', 'auto'];
const big = document.getElementById('big')!;
const label = document.getElementById('label')!;
const fill = document.getElementById('fill')!;
const pill = document.getElementById('pill')!;
let flashTimer: number | undefined;

window.__setZoom = (v) => {
  if (!v || typeof v.text !== 'string' || typeof v.label !== 'string') return;
  big.textContent = v.text;
  label.textContent = v.label;
  document.body.dataset.mode = MODES.includes(v.mode) ? v.mode : 'none';
  const f = typeof v.fraction === 'number' && Number.isFinite(v.fraction) ? Math.min(1, Math.max(0, v.fraction)) : 0;
  fill.style.width = `${(f * 100).toFixed(1)}%`;
};

window.__flash = () => {
  pill.classList.add('flash');
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => pill.classList.remove('flash'), 350);
};

export {};
