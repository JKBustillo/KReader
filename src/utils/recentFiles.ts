import { Store } from "@tauri-apps/plugin-store";

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(".recent-files.dat"));

export async function getRecentFiles(): Promise<string[]> {
  const store = await getStore();
  return (await store.get<string[]>("recentFiles")) || [];
}

export async function addRecentFile(path: string) {
  const current = await getRecentFiles();
  const filtered = current.filter((p) => p !== path);
  filtered.unshift(path);
  const updated = filtered.slice(0, 10);
  const store = await getStore();
  await store.set("recentFiles", updated);
  await store.save();
  return updated;
}

export async function saveRecentFiles(files: string[]) {
  const store = await getStore();
  await store.set("recentFiles", files);
  await store.save();
}
