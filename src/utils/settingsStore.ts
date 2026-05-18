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
