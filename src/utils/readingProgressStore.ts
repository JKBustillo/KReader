import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = ".reading-progress.dat";

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(STORE_FILE));

export async function getPageForPath(filePath: string): Promise<number> {
  const store = await getStore();
  return (await store.get<number>(`${filePath}-page`)) ?? 0;
}
