/**
 * Live annotation overlay: closed (no window), draw (captures the mouse, toolbar visible) or
 * passthrough (strokes stay on screen, clicks go through to the apps below).
 */
export type AnnotationMode = 'closed' | 'draw' | 'passthrough';

/** The hotkey: opens drawing, closes an open overlay, and resumes drawing from click-through. */
export function modeAfterHotkey(m: AnnotationMode): AnnotationMode {
  return m === 'draw' ? 'closed' : 'draw';
}

/** Esc stops drawing but keeps the strokes visible (click-through); it does nothing otherwise. */
export function modeAfterEscape(m: AnnotationMode): AnnotationMode {
  return m === 'draw' ? 'passthrough' : m;
}

export const PEN_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff'] as const;
export const PEN_WIDTHS = [3, 6, 12] as const;
export const MAX_STROKES = 400;
export const MAX_POINTS_PER_STROKE = 4000;
