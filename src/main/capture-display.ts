import { desktopCapturer, screen } from 'electron';
import type { DisplayInfo } from '../shared/ipc';
import { resolveDisplayForSource } from '../shared/cursor-map';
import { captureKindOf, decideCaptureMatch, type AnnotationDisplay } from '../shared/annotation-strokes';
import type { Rect } from '../shared/overlay-layout';
import { getSelectedSource } from './capture-selection';

const toInfo = (d: Electron.Display): DisplayInfo => ({
  id: String(d.id),
  bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
  scaleFactor: d.scaleFactor,
});

/** The display shown by the currently selected capture source; null for window sources / unknown. */
export async function selectedSourceDisplay(): Promise<DisplayInfo | null> {
  const id = getSelectedSource();
  if (!id || !id.startsWith('screen:')) return null;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  return resolveDisplayForSource(id, sources, screen.getAllDisplays().map(toInfo));
}

/** Guess for a screen source with an unresolvable display: the one under the cursor (manual zoom only). */
export function cursorDisplayGuess(): DisplayInfo {
  return toInfo(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
}

/** Where to put the annotation overlay: the captured display, else the one under the cursor. */
export async function annotationDisplayBounds(): Promise<DisplayInfo['bounds']> {
  const captured = await selectedSourceDisplay().catch(() => null);
  return captured?.bounds ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
}

/** Tags strokes drawn on the overlay at `bounds`: its display id and whether it is the captured display. */
export async function describeAnnotationDisplay(bounds: Rect): Promise<Omit<AnnotationDisplay, 'widthDip'>> {
  const id = String(screen.getDisplayMatching(bounds).id);
  const captureKind = captureKindOf(getSelectedSource());
  const captured = captureKind === 'screen' ? await selectedSourceDisplay().catch(() => null) : null;
  const captureDisplayId = captured?.id ?? '';
  // Unknown captured display: the overlay is only known to sit on it when it is the sole display. With several
  // displays it may be on another one, and composing its strokes onto the recording would put them in the wrong place.
  const ambiguous = captureKind === 'screen' && !captureDisplayId && screen.getAllDisplays().length > 1;
  return { id, captureKind, captureDisplayId, onCapture: !ambiguous && decideCaptureMatch(captureKind, captureDisplayId || null, id) };
}
