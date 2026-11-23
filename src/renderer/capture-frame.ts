/** Capture-frame page: main pushes a validated region (0..1 fractions of the display) through __setRegion. */
interface RegionView { x: number; y: number; w: number; h: number }
declare global {
  interface Window { __setRegion?: (r: RegionView | null) => void }
}

const box = document.getElementById('box')!;

window.__setRegion = (r) => {
  if (!r || ![r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.style.left = `${(r.x * 100).toFixed(3)}%`;
  box.style.top = `${(r.y * 100).toFixed(3)}%`;
  box.style.width = `${(r.w * 100).toFixed(3)}%`;
  box.style.height = `${(r.h * 100).toFixed(3)}%`;
};

export {};
