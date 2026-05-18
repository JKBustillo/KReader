import { Store } from "@tauri-apps/plugin-store";
import type { ViewMode } from "../types/library";

const SETTINGS_FILE = ".settings.dat";
const KEY_LIBRARY_VIEW_MODE = "library-view-mode";

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
