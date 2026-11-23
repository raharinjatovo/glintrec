import { MAX_POINTS_PER_STROKE, MAX_STROKES, PEN_COLORS, PEN_WIDTHS } from '../shared/annotation';
import { barLayout, clampBarPos, defaultBarPos, widthDotSize } from '../shared/annotation-bar';
import { createStrokeSender } from '../shared/stroke-sender';

// Draw overlay page: pen, color, width, clear. Mode switching (Esc, hotkey) is done by the main process,
// which flips body[data-mode]; this page only draws. Strokes live in memory and are never saved. Each stroke is
// also sent (normalized 0..1) to the main process while the pen is still down (throttled, only the new points)
// and once more on pen-up, and main forwards it to the recorder: this window is hidden from screen capture, so the
// recording canvas draws the strokes itself.
interface Stroke { color: string; width: number; pts: { x: number; y: number }[] }
/** Minimum time between two messages of the stroke being drawn (~25 per second). */
const SEND_INTERVAL_MS = 40;

const cv = document.getElementById('ink') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const strokes: Stroke[] = [];
let color: string = PEN_COLORS[0];
let width: number = PEN_WIDTHS[1];
let current: Stroke | null = null;
let nextId = 1;
const unit = (v: number) => Math.min(1, Math.max(0, v));
const sender = createStrokeSender(
  (u) => window.annotationApi?.sendStroke(u),
  SEND_INTERVAL_MS,
  { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
);
/** Normalized copy (0..1 of the overlay) of the points of the stroke being drawn; this is what the sender reads. */
let norm: number[] = [];
function addPoint(x: number, y: number): void {
  current!.pts.push({ x, y });
  norm.push(unit(x / (innerWidth || 1)), unit(y / (innerHeight || 1)));
}

function redraw(): void {
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(innerWidth * dpr) || cv.height !== Math.round(innerHeight * dpr)) {
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    if (s.pts.length === 1) {
      ctx.beginPath();
      ctx.arc(s.pts[0].x, s.pts[0].y, s.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    for (let i = 1; i < s.pts.length - 1; i++) {
      const mx = (s.pts[i].x + s.pts[i + 1].x) / 2;
      const my = (s.pts[i].y + s.pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(s.pts[i].x, s.pts[i].y, mx, my);
    }
    const last = s.pts[s.pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || document.body.dataset.mode !== 'draw') return;
  endStroke(); // a lost pointerup must not leave the previous stroke unsent
  current = { color, width, pts: [] };
  norm = [];
  strokes.push(current);
  if (strokes.length > MAX_STROKES) strokes.shift();
  sender.begin({ id: nextId++, color, width }, norm);
  addPoint(e.clientX, e.clientY);
  sender.changed();
  cv.setPointerCapture(e.pointerId);
  redraw();
});
cv.addEventListener('pointermove', (e) => {
  if (!current || current.pts.length >= MAX_POINTS_PER_STROKE) return;
  addPoint(e.clientX, e.clientY);
  sender.changed();
  redraw();
});
function endStroke(): void { sender.end(); current = null; }
cv.addEventListener('pointerup', endStroke);
cv.addEventListener('pointercancel', endStroke);
window.addEventListener('resize', redraw);

// Toolbar: placed from barLayout() with fixed pixel sizes, because the recorder paints a copy from the same layout.
const L = barLayout();
const barWrap = document.getElementById('barWrap') as HTMLElement;
const barEl = document.getElementById('bar') as HTMLElement;
const gripEl = document.getElementById('grip') as HTMLElement;
type PxRect = { x: number; y: number; width: number; height: number };
function place(el: HTMLElement, r: PxRect): void {
  el.style.left = `${r.x}px`; el.style.top = `${r.y}px`; el.style.width = `${r.width}px`; el.style.height = `${r.height}px`;
}
barEl.style.width = `${L.width}px`;
barEl.style.height = `${L.height}px`;
place(gripEl, L.grip);
place(document.getElementById('clear')!, L.clear);
place(document.getElementById('close')!, L.close);

/** Bar position as 0..1 fractions of the overlay, so it survives a resize and is what the recorder gets. */
let barX = 0;
let barY = 0;
const viewport = () => ({ width: innerWidth || 1, height: innerHeight || 1 });
function applyBarPos(): void {
  const vp = viewport();
  ({ x: barX, y: barY } = clampBarPos(barX, barY, L, vp));
  barWrap.style.transform = `translate(${barX * vp.width}px, ${barY * vp.height}px)`;
  hintEl.classList.toggle('right', barX * vp.width + 420 > vp.width);
}
/** Pointer over the bar (0..1 of the overlay) or null; the recorder draws the cursor above the bar from it. */
let cursorFrac: { x: number; y: number } | null = null;
let lastBarSend = 0;
let barTimer: number | undefined;
function sendBarNow(): void {
  if (barTimer !== undefined) { window.clearTimeout(barTimer); barTimer = undefined; }
  lastBarSend = Date.now();
  window.annotationApi?.sendBar({ x: barX, y: barY, color, width, visible: true, cursor: cursorFrac });
}
/** Throttled while dragging, with a trailing send so the last position always arrives. */
function sendBarSoon(): void {
  const wait = SEND_INTERVAL_MS - (Date.now() - lastBarSend);
  if (wait <= 0) { sendBarNow(); return; }
  if (barTimer === undefined) barTimer = window.setTimeout(sendBarNow, wait);
}
// Main calls this when drawing resumes: the recorder dropped the bar while the overlay was click-through.
window.resendBar = () => { cursorFrac = null; sendBarNow(); };

const swatchEls: HTMLButtonElement[] = [];
const widthEls: HTMLButtonElement[] = [];
function mark(list: HTMLButtonElement[], on: number): void { list.forEach((b, i) => b.classList.toggle('on', i === on)); }
function makeButton(cls: string, rect: PxRect, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  place(b, rect);
  b.setAttribute('aria-label', label);
  barEl.appendChild(b);
  return b;
}
PEN_COLORS.forEach((c, i) => {
  const b = makeButton('sw', L.swatches[i], `Pen color ${c}`);
  b.style.background = c;
  b.onclick = () => { color = c; mark(swatchEls, i); sendBarNow(); };
  swatchEls.push(b);
});
PEN_WIDTHS.forEach((w, i) => {
  const b = makeButton('wd', L.widths[i], `Pen width ${w}`);
  const dot = document.createElement('i');
  dot.style.width = dot.style.height = `${widthDotSize(w)}px`;
  b.appendChild(dot);
  b.onclick = () => { width = w; mark(widthEls, i); sendBarNow(); };
  widthEls.push(b);
});
mark(swatchEls, PEN_COLORS.findIndex((c) => c === color));
mark(widthEls, PEN_WIDTHS.findIndex((w) => w === width));

(document.getElementById('clear') as HTMLButtonElement).onclick = () => {
  strokes.length = 0;
  sender.cancel();
  current = null;
  redraw();
  window.annotationApi?.sendClear();
  sendBarNow(); // a clear also drops the recorder's copy of the bar: put it back
};
// Closes this overlay window (the main process notices the closed window).
(document.getElementById('close') as HTMLButtonElement).onclick = () => window.close();

// Drag by the grip. Pointer capture keeps the events coming; the canvas never sees them, so no stroke starts.
let drag: { dx: number; dy: number; id: number } | null = null;
gripEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const vp = viewport();
  drag = { dx: e.clientX - barX * vp.width, dy: e.clientY - barY * vp.height, id: e.pointerId };
  gripEl.setPointerCapture(e.pointerId);
  gripEl.classList.add('drag');
  e.preventDefault();
});
gripEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (e.buttons === 0) { endDrag(); return; } // the release was missed (e.g. Esc hid the bar mid-drag)
  const vp = viewport();
  barX = (e.clientX - drag.dx) / vp.width;
  barY = (e.clientY - drag.dy) / vp.height;
  applyBarPos();
  sendBarSoon();
});
function endDrag(): void {
  if (!drag) return;
  drag = null;
  gripEl.classList.remove('drag');
  sendBarNow();
}
barEl.addEventListener('pointermove', (e) => {
  const vp = viewport();
  cursorFrac = { x: Math.min(1, Math.max(0, e.clientX / vp.width)), y: Math.min(1, Math.max(0, e.clientY / vp.height)) };
  sendBarSoon();
});
barEl.addEventListener('pointerleave', () => { cursorFrac = null; sendBarNow(); });
gripEl.addEventListener('pointerup', endDrag);
gripEl.addEventListener('pointercancel', endDrag);
gripEl.addEventListener('lostpointercapture', endDrag);
window.addEventListener('resize', () => { applyBarPos(); sendBarNow(); });

// Recording controls (Pause/Reprendre, mode switch, Stop) rendered here because this window demonstrably gets clicks.
// The view comes from main (validated there); a click sends a whitelisted command that main re-validates and relays.
const ctlEl = document.getElementById('ctl') as HTMLElement;
const ctlBtn = (id: string, cmd: 'pause-toggle' | 'switch-mode' | 'stop') => {
  const b = document.getElementById(id) as HTMLButtonElement;
  b.onclick = () => {
    console.log('[control-hud] overlay click', cmd, window.annotationApi ? '' : '(no api)');
    window.annotationApi?.sendControl(cmd);
  };
  return b;
};
const ctlPause = ctlBtn('ctl-pause', 'pause-toggle');
const ctlMode = ctlBtn('ctl-mode', 'switch-mode');
const ctlStop = ctlBtn('ctl-stop', 'stop');
window.annotationApi?.onControlView((v) => {
  if (!v || typeof v.pauseLabel !== 'string' || typeof v.modeLabel !== 'string') { ctlEl.hidden = true; return; }
  ctlPause.textContent = v.pauseLabel;
  ctlMode.textContent = v.modeLabel;
  ctlStop.textContent = typeof v.stopLabel === 'string' ? v.stopLabel : 'Arrêter';
  ctlMode.disabled = v.canSwitch !== true;
  ctlEl.hidden = false;
});

// The main process passes the (validated) close hotkey in the URL.
const hk = new URLSearchParams(location.search).get('hk');
const hintEl = document.getElementById('hint') as HTMLElement;
const defaultHint = `Esc: stop drawing (keeps the drawing)${hk ? ` - ${hk}: close` : ''}`;
hintEl.textContent = defaultHint;
// Main calls this when strokes cannot reach the recording (e.g. a window is captured instead of a screen).
window.setAnnotationNotice = (msg) => {
  hintEl.textContent = msg ?? defaultHint;
  hintEl.style.color = msg ? '#ff6b60' : '';
};
({ x: barX, y: barY } = defaultBarPos(L, viewport()));
applyBarPos();
redraw();
sendBarNow();

// A missing preload bridge would otherwise fail silently (strokes are sent with optional chaining): say so.
if (!window.annotationApi) {
  console.error('annotation bridge not loaded: window.annotationApi is undefined, strokes will not be recorded');
  hintEl.textContent = 'Annotation bridge not loaded - strokes will not be recorded';
  hintEl.style.color = '#ff6b60';
}
