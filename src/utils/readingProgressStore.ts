import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = ".reading-progress.dat";
const PAGE_SUFFIX = "-page";
const CASCADE_SUFFIX = "-cascade";
const BOOKMARKS_SUFFIX = "-bookmarks";

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(STORE_FILE));

const pageKey = (filePath: string) => `${filePath}${PAGE_SUFFIX}`;
const cascadeKey = (filePath: string) => `${filePath}${CASCADE_SUFFIX}`;
const bookmarksKey = (filePath: string) => `${filePath}${BOOKMARKS_SUFFIX}`;

export type ReadingProgress = {
  page?: number;
  cascade?: boolean;
  bookmarks?: number[];
};

export async function getReadingProgress(filePath: string): Promise<ReadingProgress> {
  const store = await getStore();
  const [page, cascade, bookmarks] = await Promise.all([
    store.get<number>(pageKey(filePath)),
    store.get<boolean>(cascadeKey(filePath)),
    store.get<number[]>(bookmarksKey(filePath)),
  ]);
  return { page, cascade, bookmarks };
}

export async function getSavedPage(filePath: string): Promise<number | undefined> {
  const store = await getStore();
  return store.get<number>(pageKey(filePath));
}

export async function savePage(filePath: string, page: number): Promise<void> {
  const store = await getStore();
  await store.set(pageKey(filePath), page);
  await store.save();
}

export async function saveCascade(filePath: string, cascade: boolean): Promise<void> {
  const store = await getStore();
  await store.set(cascadeKey(filePath), cascade);
  await store.save();
}

export async function saveBookmarks(filePath: string, bookmarks: number[]): Promise<void> {
  const store = await getStore();
  await store.set(bookmarksKey(filePath), bookmarks);
  await store.save();
}

// Convenience for non-hook callers that only need the page (defaults to 0).
export async function getPageForPath(filePath: string): Promise<number> {
  return (await getSavedPage(filePath)) ?? 0;
}
