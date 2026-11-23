import { desktopCapturer, type BrowserWindow } from 'electron';
import type { CaptureSource } from '../shared/ipc';

export async function listCaptureSources(ownWindow?: BrowserWindow | null): Promise<CaptureSource[]> {
  const ownId = ownWindow && !ownWindow.isDestroyed() ? ownWindow.getMediaSourceId() : null;
  const raw = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return raw
    .filter((s) => s.id.startsWith('screen:') || (s.name.trim() !== '' && s.id !== ownId))
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
      thumbnailDataUrl: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      displayId: s.display_id || undefined,
    }));
}
