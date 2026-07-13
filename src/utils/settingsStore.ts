import { Store } from "@tauri-apps/plugin-store";
import type { ViewMode } from "../types/library";

const SETTINGS_FILE = ".settings.dat";
const KEY_LIBRARY_VIEW_MODE = "library-view-mode";
const KEY_LAST_APP_VIEW = "last-app-view";

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(SETTINGS_FILE));

export async function getLibraryViewMode(): Promise<ViewMode> {
  const store = await getStore();
  return (await store.get<ViewMode>(KEY_LIBRARY_VIEW_MODE)) ?? "details";
}

export async function saveLibraryViewMode(mode: ViewMode): Promise<void> {
  const store = await getStore();
  await store.set(KEY_LIBRARY_VIEW_MODE, mode);
  await store.save();
}

export async function getLastAppView(): Promise<"home" | "library"> {
  const store = await getStore();
  return (await store.get<"home" | "library">(KEY_LAST_APP_VIEW)) ?? "home";
}

export async function saveLastAppView(view: "home" | "library"): Promise<void> {
  const store = await getStore();
  await store.set(KEY_LAST_APP_VIEW, view);
  await store.save();
}

const KEY_SHOW_PROGRESS_BAR = "show-progress-bar";

export async function getShowProgressBar(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>(KEY_SHOW_PROGRESS_BAR)) ?? false;
}

export async function saveShowProgressBar(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_SHOW_PROGRESS_BAR, value);
  await store.save();
}

const KEY_PIN_PAGE_INDICATOR = "pin-page-indicator";

export async function getPinPageIndicator(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>(KEY_PIN_PAGE_INDICATOR)) ?? false;
}

export async function savePinPageIndicator(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_PIN_PAGE_INDICATOR, value);
  await store.save();
}

const KEY_EPUB_FONT_SIZE = "epub-font-size";
// Reading font size (percent) for the EPUB reader. Global preference, like most
// e-readers — the last size applies to every book on reopen.
const EPUB_FONT_SIZE_DEFAULT = 100;

export async function getEpubFontSize(): Promise<number> {
  const store = await getStore();
  return (await store.get<number>(KEY_EPUB_FONT_SIZE)) ?? EPUB_FONT_SIZE_DEFAULT;
}

export async function saveEpubFontSize(value: number): Promise<void> {
  const store = await getStore();
  await store.set(KEY_EPUB_FONT_SIZE, value);
  await store.save();
}

// Which value the EPUB reader's progress indicator shows: overall percent,
// pages within the current chapter (reflows with font size), or a stable
// book-wide page count from the location table. Global preference.
export type EpubProgressMode = "percent" | "chapter" | "total";
const KEY_EPUB_PROGRESS_MODE = "epub-progress-mode";
const EPUB_PROGRESS_MODE_DEFAULT: EpubProgressMode = "percent";

export async function getEpubProgressMode(): Promise<EpubProgressMode> {
  const store = await getStore();
  return (await store.get<EpubProgressMode>(KEY_EPUB_PROGRESS_MODE)) ?? EPUB_PROGRESS_MODE_DEFAULT;
}

export async function saveEpubProgressMode(value: EpubProgressMode): Promise<void> {
  const store = await getStore();
  await store.set(KEY_EPUB_PROGRESS_MODE, value);
  await store.save();
}

const KEY_SHOW_PAGE_COUNT = "show-page-count";

export async function getShowPageCount(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>(KEY_SHOW_PAGE_COUNT)) ?? false;
}

export async function saveShowPageCount(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_SHOW_PAGE_COUNT, value);
  await store.save();
}

const KEY_AUTO_BACKUP = "auto-backup";

export async function getAutoBackup(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>(KEY_AUTO_BACKUP)) ?? false;
}

export async function saveAutoBackup(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_AUTO_BACKUP, value);
  await store.save();
}

const KEY_LAST_BACKUP_AT = "last-backup-at";

export async function getLastBackupAt(): Promise<number> {
  const store = await getStore();
  return (await store.get<number>(KEY_LAST_BACKUP_AT)) ?? 0;
}

export async function saveLastBackupAt(timestampMs: number): Promise<void> {
  const store = await getStore();
  await store.set(KEY_LAST_BACKUP_AT, timestampMs);
  await store.save();
}

const KEY_KEEP_DATA_ON_REMOVE = "keep-data-on-remove";

export async function getKeepDataOnRemove(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>(KEY_KEEP_DATA_ON_REMOVE)) ?? true;
}

export async function saveKeepDataOnRemove(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_KEEP_DATA_ON_REMOVE, value);
  await store.save();
}

const KEY_RECENT_TAGS = "recent-custom-tags";
// How many recently-assigned custom tag values to remember for the quick-pick
// list shown when the tag input is focused but empty.
const MAX_RECENT_TAGS = 12;

export async function getRecentTags(): Promise<string[]> {
  const store = await getStore();
  return (await store.get<string[]>(KEY_RECENT_TAGS)) ?? [];
}

// Records assigned tag values as most-recent-first, de-duplicated
// case-insensitively (newest occurrence wins), capped at MAX_RECENT_TAGS.
export async function pushRecentTags(values: string[]): Promise<void> {
  const incoming = values.map((v) => v.trim()).filter((v) => v.length > 0);
  if (incoming.length === 0) return;
  const store = await getStore();
  const existing = (await store.get<string[]>(KEY_RECENT_TAGS)) ?? [];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...incoming, ...existing]) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  await store.set(KEY_RECENT_TAGS, merged.slice(0, MAX_RECENT_TAGS));
  await store.save();
}

// Removes values from the recents MRU (case-insensitive). Called when a custom
// tag is renamed or deleted library-wide so stale values stop appearing in the
// quick-pick.
export async function removeRecentTags(values: string[]): Promise<void> {
  const drop = new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0));
  if (drop.size === 0) return;
  const store = await getStore();
  const existing = (await store.get<string[]>(KEY_RECENT_TAGS)) ?? [];
  const filtered = existing.filter((v) => !drop.has(v.toLowerCase()));
  if (filtered.length === existing.length) return;
  await store.set(KEY_RECENT_TAGS, filtered);
  await store.save();
}

const KEY_FAVORITES_RESPECT_FOLDERS = "favorites-respect-folders";

export async function getFavoritesRespectFolders(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>(KEY_FAVORITES_RESPECT_FOLDERS)) ?? false;
}

export async function saveFavoritesRespectFolders(value: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_FAVORITES_RESPECT_FOLDERS, value);
  await store.save();
}

const favoritesFilterKey = (libraryId: string) => `favorites-filter:${libraryId}`;

export async function getFavoritesFilter(libraryId: string): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>(favoritesFilterKey(libraryId))) ?? false;
}

export async function saveFavoritesFilter(libraryId: string, value: boolean): Promise<void> {
  const store = await getStore();
  await store.set(favoritesFilterKey(libraryId), value);
  await store.save();
}

const folderFilterKey = (libraryId: string) => `folder-filter:${libraryId}`;

export async function getSavedFolderFilter(
  libraryId: string,
): Promise<Map<string, "full" | "partial">> {
  const store = await getStore();
  const raw = await store.get<Record<string, "full" | "partial">>(folderFilterKey(libraryId));
  if (!raw) return new Map();
  return new Map(Object.entries(raw));
}

export async function saveFolderFilter(
  libraryId: string,
  folders: Map<string, "full" | "partial">,
): Promise<void> {
  const store = await getStore();
  await store.set(folderFilterKey(libraryId), Object.fromEntries(folders));
  await store.save();
}
