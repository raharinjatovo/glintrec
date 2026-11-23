import { PEN_COLORS, PEN_WIDTHS } from './annotation';
import type { Rect, Size } from './overlay-layout';

/**
 * The draw overlay's toolbar as data. The overlay window is hidden from screen capture, so the recorder paints the
 * bar itself from this state. `x` / `y` are the bar's top-left as 0..1 fractions of the overlay display.
 */
export interface BarState {
  x: number; y: number; color: string; width: number; visible: boolean;
  /** Pointer position (0..1 of the display) while it is over the bar, so the recorder can draw the cursor above the bar. */
  cursor?: { x: number; y: number } | null;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validate a bar message from an untrusted sender; null when anything is off. */
export function sanitizeBarState(raw: unknown): BarState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.x) || !finite(r.y) || r.x < 0 || r.x > 1 || r.y < 0 || r.y > 1) return null;
  const color = PEN_COLORS.find((c) => c === r.color);
  const width = PEN_WIDTHS.find((w) => w === r.width);
  if (!color || !width || typeof r.visible !== 'boolean') return null;
  const base: BarState = { x: r.x, y: r.y, color, width, visible: r.visible };
  if (r.cursor === undefined || r.cursor === null) return base;
  const c = r.cursor as Record<string, unknown> | string;
  if (typeof c !== 'object' || !finite(c.x) || !finite(c.y) || c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1) return null;
  return { ...base, cursor: { x: c.x, y: c.y } };
}

/** Fixed bar geometry in DIP, relative to the bar's top-left. The DOM bar and the recorder's painting both use it. */
export interface BarLayout {
  width: number; height: number;
  grip: Rect; swatches: Rect[]; widths: Rect[]; clear: Rect; close: Rect;
}

export const BAR_PAD_X = 8;
export const BAR_PAD_Y = 6;
export const BAR_GAP = 8;
export const BAR_ITEM_GAP = 6;
export const BAR_GRIP_W = 14;
export const BAR_SWATCH = 22;
export const BAR_WIDTH_BTN = { width: 30, height: 22 } as const;
export const BAR_TEXT_BTN = { width: 52, height: 26 } as const;
/** Default distance of the bar from the top of the display, in DIP. */
export const BAR_TOP_MARGIN = 12;

export function barLayout(): BarLayout {
  const inner = BAR_TEXT_BTN.height;
  const height = inner + BAR_PAD_Y * 2;
  const centred = (h: number) => BAR_PAD_Y + (inner - h) / 2;
  let x = BAR_PAD_X;
  const grip: Rect = { x, y: BAR_PAD_Y, width: BAR_GRIP_W, height: inner };
  x += BAR_GRIP_W + BAR_GAP;
  const swatches = PEN_COLORS.map((_, i) => ({
    x: x + i * (BAR_SWATCH + BAR_ITEM_GAP), y: centred(BAR_SWATCH), width: BAR_SWATCH, height: BAR_SWATCH,
  }));
  x += PEN_COLORS.length * BAR_SWATCH + (PEN_COLORS.length - 1) * BAR_ITEM_GAP + BAR_GAP;
  const widths = PEN_WIDTHS.map((_, i) => ({
    x: x + i * (BAR_WIDTH_BTN.width + BAR_ITEM_GAP), y: centred(BAR_WIDTH_BTN.height), ...BAR_WIDTH_BTN,
  }));
  x += PEN_WIDTHS.length * BAR_WIDTH_BTN.width + (PEN_WIDTHS.length - 1) * BAR_ITEM_GAP + BAR_GAP;
  const clear: Rect = { x, y: BAR_PAD_Y, ...BAR_TEXT_BTN };
  x += BAR_TEXT_BTN.width + BAR_ITEM_GAP;
  const close: Rect = { x, y: BAR_PAD_Y, ...BAR_TEXT_BTN };
  x += BAR_TEXT_BTN.width + BAR_PAD_X;
  return { width: x, height, grip, swatches, widths, clear, close };
}

/** Diameter of the dot inside a width button, in DIP. */
export const widthDotSize = (w: number): number => Math.min(16, w + 2);

/**
 * Keep the bar fully inside the display. `x` / `y` are fractions of `viewport` (DIP), `size` the bar in DIP.
 * A bar larger than the viewport sticks to the top-left corner. Non-finite input falls back to 0.
 */
export function clampBarPos(x: number, y: number, size: Size, viewport: Size): { x: number; y: number } {
  const maxX = viewport.width > 0 ? Math.max(0, 1 - size.width / viewport.width) : 0;
  const maxY = viewport.height > 0 ? Math.max(0, 1 - size.height / viewport.height) : 0;
  const c = (v: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
  return { x: c(x, maxX), y: c(y, maxY) };
}

/** Top-centre, as the bar has always started. */
export function defaultBarPos(size: Size, viewport: Size): { x: number; y: number } {
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0 };
  return clampBarPos((1 - size.width / viewport.width) / 2, BAR_TOP_MARGIN / viewport.height, size, viewport);
}
