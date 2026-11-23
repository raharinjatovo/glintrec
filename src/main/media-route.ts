import { isLibraryId } from '../shared/library';

/** Host of the `app:` URLs that serve saved recordings for preview: app://media/<library id>. */
export const MEDIA_HOST = 'media';

/** The library id addressed by an app://media/<id> URL, or null for anything else (extra path, bad id). */
export function mediaIdFromUrl(url: URL): string | null {
  if (url.host !== MEDIA_HOST) return null;
  const m = /^\/([^/]+)$/.exec(url.pathname);
  return m && isLibraryId(m[1]) ? m[1] : null;
}
