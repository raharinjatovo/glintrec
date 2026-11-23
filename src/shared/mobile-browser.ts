// Pure logic of the built-in mobile browser window (address parsing, window sizing, navigation allow-list, bar messages).

export const SEARCH_URL = 'https://duckduckgo.com/?q=';
export const HOME_URL = 'https://duckduckgo.com/';
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
/** Height of the browser bar (CSS px) at the top of the window; the page view sits below it. */
export const BAR_HEIGHT = 44;
/** Window content ratio: width:height = 9:16. */
export const PORTRAIT = { w: 9, h: 16 } as const;

export const MOBILE_BROWSER_CHANNELS = { command: 'mobilebrowser:command' } as const;
export const MOBILE_BROWSER_STATE_EVENT = 'mobilebrowser:state';

export type AddressResult = { kind: 'url'; url: string } | { kind: 'search'; url: string } | null;

const MAX_INPUT = 2048;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT = /^[^\s/:?#@]+:\d{1,5}(?:[/?#]|$)/;

function searchFor(text: string): AddressResult {
  return { kind: 'search', url: SEARCH_URL + encodeURIComponent(text) };
}

/** http(s) only, with a host and no embedded credentials. Used for typed addresses, redirects, popups and link clicks. */
export function isAllowedNavigation(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 8192) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '' && u.username === '' && u.password === '';
}

function isIpv4(host: string): boolean {
  const m = IPV4.exec(host);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

/**
 * What the address bar means: an http(s) URL, a search query, or null (empty / refused, e.g. javascript:, data:, file:).
 * Bare hosts get https://; localhost and IPv4 addresses get http:// (dev servers rarely have TLS).
 */
export function normalizeAddress(input: unknown): AddressResult {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text === '' || text.length > MAX_INPUT) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text) || text.includes('\\')) return null;
  if (/^https?:\/\//i.test(text)) {
    return isAllowedNavigation(text) ? { kind: 'url', url: new URL(text).toString() } : null;
  }
  if (text.startsWith('//')) return null;
  if (SCHEME.test(text) && !HOST_PORT.test(text)) {
    // "word: more words" is a search; "javascript:alert(1)", "file:///x", "data:..." (no whitespace right after) are refused.
    return /^[a-z][a-z0-9+.-]*:\s/i.test(text) ? searchFor(text) : null;
  }
  if (/\s/.test(text)) return searchFor(text);
  const authority = text.split(/[/?#]/, 1)[0] ?? '';
  const hostPart = authority.replace(/:\d{1,5}$/, '');
  const local = hostPart.toLowerCase() === 'localhost' || isIpv4(hostPart);
  if (!authority.includes('@') && (local || DOMAIN.test(hostPart))) {
    const candidate = `${local ? 'http' : 'https'}://${text}`;
    if (isAllowedNavigation(candidate)) return { kind: 'url', url: new URL(candidate).toString() };
  }
  return searchFor(text);
}

export interface Size { width: number; height: number }

/**
 * Content size of the window: exact `ratio` (integer w:h, so no rounding drift), preferably 396x704, shrunk to fit
 * 90% of the work area minus the window frame (`chrome`).
 */
export function windowSizeFor(
  workArea: Size, ratio: { w: number; h: number } = PORTRAIT, chrome: Size = { width: 0, height: 0 },
): Size {
  const maxW = workArea.width * 0.9 - chrome.width;
  const maxH = workArea.height * 0.9 - chrome.height;
  const unit = Math.min(44, Math.floor(maxW / ratio.w), Math.floor(maxH / ratio.h));
  const k = Math.max(20, Number.isFinite(unit) ? unit : 44);
  return { width: k * ratio.w, height: k * ratio.h };
}

/** Bounds of the page view inside a window of the given content size. */
export function pageBounds(content: Size): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: BAR_HEIGHT, width: Math.max(1, content.width), height: Math.max(1, content.height - BAR_HEIGHT) };
}

export type MobileBrowserCommand =
  | { type: 'navigate'; text: string }
  | { type: 'back' | 'forward' | 'reload' | 'home' };

/** Validates a message from the bar page; anything unexpected -> null. */
export function parseCommand(raw: unknown): MobileBrowserCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { type?: unknown; text?: unknown };
  if (r.type === 'navigate') return typeof r.text === 'string' && r.text.length <= MAX_INPUT ? { type: 'navigate', text: r.text } : null;
  if (r.type === 'back' || r.type === 'forward' || r.type === 'reload' || r.type === 'home') return { type: r.type };
  return null;
}

/** Main -> bar page. */
export interface BarState { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; notice: string }
