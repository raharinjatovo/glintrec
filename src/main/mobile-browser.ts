import { BrowserWindow, WebContentsView, session, type WebContents } from 'electron';
import * as path from 'node:path';
import type { Rect } from '../shared/overlay-layout';
import {
  HOME_URL, MOBILE_BROWSER_STATE_EVENT, MOBILE_UA, normalizeAddress, pageBounds, parseCommand, windowSizeFor,
  isAllowedNavigation, type BarState, type Size,
} from '../shared/mobile-browser';

const ORIGIN = 'app://local';
const PARTITION = 'persist:mobile-browser';
const TITLE = 'Glintrec - Mobile';
const DEVICE_SCALE = 2;

/**
 * Phone-shaped (9:16) browser window to record in the 'mobile' output format. The window shows a small bar page
 * (app://local, own preload, validated commands only); the web page lives in a separate sandboxed WebContentsView below it,
 * with a mobile user agent and Chromium device emulation so sites serve their mobile layout.
 */
export class MobileBrowser {
  private win: BrowserWindow | null = null;
  private view: WebContentsView | null = null;
  private notice = '';
  /** True once the page view has navigated at least once (device emulation is only safe from then on). */
  private emulationReady = false;

  private onFrame: ((frame: Rect | null) => void) | null = null;

  /** Called with the window's screen bounds (DIP) whenever it moves / resizes / appears, null when it hides or closes. */
  setFrameListener(fn: ((frame: Rect | null) => void) | null): void { this.onFrame = fn; this.emitFrame(); }

  private emitFrame(): void {
    const w = this.win;
    const ok = !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized();
    this.onFrame?.(ok ? w!.getBounds() : null);
  }

  /** `workArea`: usable area of the display the window should fit on. */
  constructor(private readonly workArea: () => Size, private readonly distDir: string) {}

  /** Creates the window (or focuses the existing one) and resolves once it is on screen. */
  async open(): Promise<void> {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    const win = this.create();
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 4000);
      win.once('ready-to-show', () => { clearTimeout(t); resolve(); });
    });
    if (!win.isDestroyed()) { win.show(); win.focus(); }
  }

  /** desktopCapturer id of the window, for use as capture source; null when closed. */
  getMediaSourceId(): string | null {
    return this.win && !this.win.isDestroyed() ? this.win.getMediaSourceId() : null;
  }

  /** Bar page message (already routed by main.ts); ignored unless it comes from the bar page of this window. */
  handleCommand(sender: WebContents, raw: unknown): void {
    const win = this.win;
    const wc = this.view?.webContents;
    if (!win || win.isDestroyed() || !wc || wc.isDestroyed() || sender !== win.webContents) return;
    const cmd = parseCommand(raw);
    if (!cmd) return;
    this.notice = '';
    switch (cmd.type) {
      case 'navigate': {
        const r = normalizeAddress(cmd.text);
        if (!r) this.notice = 'Adresse non autorisee (http/https uniquement)';
        else this.load(wc, r.url);
        break;
      }
      case 'home': this.load(wc, HOME_URL); break;
      case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      case 'reload': wc.reload(); break;
    }
    this.pushState();
  }

  dispose(): void {
    const w = this.win;
    this.win = null;
    this.view = null;
    if (w && !w.isDestroyed()) w.destroy();
    this.emitFrame();
  }

  private load(wc: WebContents, url: string): void {
    if (!isAllowedNavigation(url)) return;
    wc.loadURL(url, { userAgent: MOBILE_UA }).catch(() => undefined); // aborted/failed loads show Chromium's error page
  }

  private create(): BrowserWindow {
    const wa = this.workArea();
    const probe = windowSizeFor(wa);
    const win = new BrowserWindow({
      width: probe.width, height: probe.height, useContentSize: true, show: false, title: TITLE, backgroundColor: '#14161a',
      icon: path.join(this.distDir, 'assets', 'icon.png'), fullscreenable: false, maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/mobile-browser-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
      },
    });
    win.setMenuBarVisibility(false);
    // Frame size is only known once the window exists: shrink the content if the frame does not fit the work area.
    const [ow, oh] = win.getSize();
    const [cw, ch] = win.getContentSize();
    const chrome = { width: ow - cw, height: oh - ch };
    const size = windowSizeFor(wa, undefined, chrome);
    win.setContentSize(size.width, size.height);
    win.setAspectRatio(size.width / size.height, chrome);
    win.setMinimumSize(180 + chrome.width, 320 + chrome.height);
    win.center();
    win.on('page-title-updated', (e) => e.preventDefault()); // keep the window name stable for the source list

    const bar = win.webContents;
    bar.setWindowOpenHandler(() => ({ action: 'deny' }));
    bar.on('will-navigate', (e) => e.preventDefault());

    this.emulationReady = false;
    const view = this.createView();
    win.contentView.addChildView(view);
    this.win = win;
    this.view = view;
    this.layout();
    win.on('resize', () => this.layout());
    for (const ev of ['move', 'moved', 'resize', 'resized', 'show', 'hide', 'minimize', 'restore', 'maximize', 'unmaximize'] as const) {
      win.on(ev as 'move', () => { if (this.win === win) this.emitFrame(); });
    }
    win.on('closed', () => { if (this.win === win) { this.win = null; this.view = null; this.emitFrame(); } });
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page'] as const) {
      view.webContents.on(ev as 'did-navigate', () => this.pushState());
    }
    bar.on('did-finish-load', () => this.pushState());

    void win.loadURL(`${ORIGIN}/renderer/mobile-browser.html`);
    this.load(view.webContents, HOME_URL);
    return win;
  }

  private createView(): WebContentsView {
    const ses = session.fromPartition(PARTITION);
    // Web pages get no device/notification/media permissions here, and downloads are refused.
    ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());
    const view = new WebContentsView({
      webPreferences: {
        session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
      },
    });
    const wc = view.webContents;
    wc.setUserAgent(MOBILE_UA);
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigation(url)) this.load(wc, url);
      return { action: 'deny' };
    });
    const guard = (e: { preventDefault(): void }, url: string) => { if (!isAllowedNavigation(url)) e.preventDefault(); };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    // Emulation can be dropped by a cross-process navigation: apply it again.
    wc.on('did-navigate', () => { this.emulationReady = true; this.applyEmulation(); });
    wc.on('did-finish-load', () => { this.emulationReady = true; this.applyEmulation(); });
    return view;
  }

  private layout(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.view) return;
    const [width, height] = win.getContentSize();
    this.view.setBounds(pageBounds({ width, height }));
    this.applyEmulation();
  }

  private applyEmulation(): void {
    const win = this.win;
    const wc = this.view?.webContents;
    if (!win || win.isDestroyed() || !wc || wc.isDestroyed()) return;
    // enableDeviceEmulation on a page that has not loaded anything yet crashes Electron natively: wait for a real page.
    if (!this.emulationReady) return;
    const [width, height] = win.getContentSize();
    const { width: w, height: h } = pageBounds({ width, height });
    wc.enableDeviceEmulation({
      screenPosition: 'mobile', screenSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 },
      viewSize: { width: w, height: h }, deviceScaleFactor: DEVICE_SCALE, scale: 1,
    });
  }

  private pushState(): void {
    const win = this.win;
    const wc = this.view?.webContents;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed() || !wc || wc.isDestroyed()) return;
    const state: BarState = {
      url: wc.getURL(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(), notice: this.notice,
    };
    win.webContents.send(MOBILE_BROWSER_STATE_EVENT, state);
  }
}
