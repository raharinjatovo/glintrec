import type { ExportFormat, LibraryItem, RecorderApi } from '../shared/ipc';
import { MIN_TRIM_SEC, formatTrimTime, parseTimeInput } from '../shared/trim';

export interface LibraryUi {
  /** Reload the list from the main process. */
  refresh(): Promise<void>;
  /** Open the trim panel for the newest entry (the recording that was just saved). */
  trimNewest(): Promise<void>;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

function describe(item: LibraryItem): string {
  const mb = `${(item.size / (1024 * 1024)).toFixed(1)} MB`;
  const date = item.createdAt > 0 ? new Date(item.createdAt).toLocaleString() : '';
  const dur = item.durationSec ? formatTrimTime(item.durationSec) : '';
  return item.missing ? 'File not found' : [dur, mb, date].filter(Boolean).join(' - ');
}

/** Side-panel recording list plus the trim panel (preview through app://media/<id>, export via the main process). */
export function createLibraryUi(api: RecorderApi, status: (text: string) => void, ffmpegAvailable: () => boolean): LibraryUi {
  const list = el('library-list');
  const note = el('library-note');
  const panel = el('trim-panel');
  const video = el<HTMLVideoElement>('trim-video');
  const startRange = el<HTMLInputElement>('trim-start-range');
  const endRange = el<HTMLInputElement>('trim-end-range');
  const startText = el<HTMLInputElement>('trim-start');
  const endText = el<HTMLInputElement>('trim-end');
  const exportBtn = el<HTMLButtonElement>('trim-export');
  const trimOpen = el<HTMLButtonElement>('trim-open');

  let items: LibraryItem[] = [];
  let trimId: string | null = null;
  let duration = 0;
  let start = 0;
  let end = 0;
  let probing = false;
  let busy = false;

  const show = (text: string) => status(text);

  function syncTrim(seekTo?: number): void {
    startRange.max = endRange.max = String(duration);
    startRange.value = String(start);
    endRange.value = String(end);
    startText.value = formatTrimTime(start);
    endText.value = formatTrimTime(end);
    exportBtn.disabled = busy || duration <= 0 || end - start < MIN_TRIM_SEC;
    if (seekTo !== undefined && duration > 0) video.currentTime = seekTo;
  }
  function setStart(v: number): void {
    start = Math.min(Math.max(0, v), Math.max(0, end - MIN_TRIM_SEC));
    syncTrim(start);
  }
  function setEnd(v: number): void {
    end = Math.max(Math.min(duration, v), Math.min(duration, start + MIN_TRIM_SEC));
    syncTrim(end);
  }
  function setDuration(d: number): void {
    duration = d;
    start = 0;
    end = d;
    syncTrim();
  }

  function closeTrim(): void {
    trimId = null;
    duration = 0;
    panel.hidden = true;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  function openTrim(item: LibraryItem): void {
    if (item.missing) { show('That file no longer exists.'); return; }
    if (!ffmpegAvailable()) { show('Trimming needs ffmpeg, which was not found.'); return; }
    trimId = item.id;
    duration = 0;
    start = end = 0;
    probing = false;
    panel.hidden = false;
    syncTrim();
    // MediaRecorder WebM reports an infinite duration until the end has been seeked to (see below).
    video.src = `app://media/${item.id}`;
    video.load();
    show(`Trimming ${item.name}: set start and end, then export.`);
  }

  video.onloadedmetadata = () => {
    if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    else { probing = true; video.currentTime = 1e101; }
  };
  video.ondurationchange = () => {
    if (!probing || !Number.isFinite(video.duration) || video.duration <= 0) return;
    probing = false;
    setDuration(video.duration);
    video.currentTime = 0;
  };
  video.onerror = () => { if (trimId) show('Cannot preview this recording.'); };

  startRange.oninput = () => setStart(Number(startRange.value));
  endRange.oninput = () => setEnd(Number(endRange.value));
  startText.onchange = () => {
    const v = parseTimeInput(startText.value);
    if (v === null) syncTrim(); else setStart(v);
  };
  endText.onchange = () => {
    const v = parseTimeInput(endText.value);
    if (v === null) syncTrim(); else setEnd(v);
  };
  el('trim-set-start').onclick = () => setStart(video.currentTime);
  el('trim-set-end').onclick = () => setEnd(video.currentTime);
  el('trim-close').onclick = closeTrim;
  exportBtn.onclick = async () => {
    if (!trimId || busy) return;
    busy = true;
    syncTrim();
    show('Trimming...');
    try {
      const res = await api.trimLibraryItem({ id: trimId, startSec: start, endSec: end, durationSec: duration });
      show(res.status === 'saved' ? `Trimmed copy saved: ${res.path}` : `Trim failed: ${res.message}`);
      if (res.status === 'saved') await refresh();
    } catch (e) {
      show(`Trim failed: ${e instanceof Error ? e.message : e}`);
    }
    busy = false;
    syncTrim();
  };

  async function runExport(item: LibraryItem, format: ExportFormat): Promise<void> {
    show(`Exporting ${format.toUpperCase()}...`);
    try {
      const res = await api.exportLibraryItem(item.id, format);
      if (res.status === 'saved') show(`Exported ${res.path}`);
      else if (res.status === 'cancelled') show('Export cancelled.');
      else show(`Export failed: ${res.message}`);
    } catch (e) {
      show(`Export failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function runAction(
    item: LibraryItem, fn: (id: string) => ReturnType<RecorderApi['openLibraryItem']>, doneText = '',
  ): Promise<void> {
    try {
      const res = await fn(item.id);
      if (res.status === 'error') show(res.message);
      else if (res.status === 'ok') show(doneText);
    } catch (e) {
      show(e instanceof Error ? e.message : String(e));
    }
  }

  function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = onClick;
    return b;
  }

  function render(): void {
    list.replaceChildren();
    note.textContent = items.length === 0 ? 'No saved recordings yet.' : '';
    const ff = ffmpegAvailable();
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'lib-item' + (item.missing ? ' missing' : '');
      const name = document.createElement('span');
      name.className = 'lib-name';
      name.textContent = item.name;
      name.title = item.name;
      const meta = document.createElement('span');
      meta.className = 'note';
      meta.textContent = describe(item);
      const actions = document.createElement('div');
      actions.className = 'lib-actions';
      const gone = item.missing;
      actions.append(
        button('Open', () => { void runAction(item, (id) => api.openLibraryItem(id)); }, gone),
        button('Folder', () => { void runAction(item, (id) => api.revealLibraryItem(id)); }, gone),
        button('Trim', () => openTrim(item), gone || !ff),
        button('MP4', () => { void runExport(item, 'mp4'); }, gone || !ff),
        button('GIF', () => { void runExport(item, 'gif'); }, gone || !ff),
        button(gone ? 'Remove' : 'Delete', () => {
          void runAction(item, (id) => api.deleteLibraryItem(id), gone ? 'Removed from the library.' : 'Moved to the Recycle Bin.')
            .then(() => { if (trimId === item.id) closeTrim(); return refresh(); });
        }),
      );
      row.append(name, meta, actions);
      list.appendChild(row);
    }
  }

  async function refresh(): Promise<void> {
    try {
      items = await api.listLibrary();
    } catch (e) {
      items = [];
      note.textContent = `Cannot load the library: ${e instanceof Error ? e.message : e}`;
      list.replaceChildren();
      return;
    }
    render();
  }

  trimOpen.onclick = () => { void trimNewest(); };
  async function trimNewest(): Promise<void> {
    await refresh();
    if (items[0]) openTrim(items[0]);
  }

  return { refresh, trimNewest };
}
