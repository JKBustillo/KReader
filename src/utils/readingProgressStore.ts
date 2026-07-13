import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = ".reading-progress.dat";
const PAGE_SUFFIX = "-page";
const CASCADE_SUFFIX = "-cascade";
const BOOKMARKS_SUFFIX = "-bookmarks";
// EPUB has no fixed page index: the exact reading position is a CFI string, and
// the generated location table (used for book-wide %) is cached here so it is
// computed once per file instead of on every open (generate() is slow on big books).
const EPUB_CFI_SUFFIX = "-epub-cfi";
const EPUB_LOCATIONS_SUFFIX = "-epub-locations";

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(STORE_FILE));

const pageKey = (filePath: string) => `${filePath}${PAGE_SUFFIX}`;
const cascadeKey = (filePath: string) => `${filePath}${CASCADE_SUFFIX}`;
const bookmarksKey = (filePath: string) => `${filePath}${BOOKMARKS_SUFFIX}`;
const epubCfiKey = (filePath: string) => `${filePath}${EPUB_CFI_SUFFIX}`;
const epubLocationsKey = (filePath: string) => `${filePath}${EPUB_LOCATIONS_SUFFIX}`;

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

// EPUB reading position (an epubjs CFI). Undefined until the file has been opened.
export async function getEpubCfi(filePath: string): Promise<string | undefined> {
  const store = await getStore();
  return store.get<string>(epubCfiKey(filePath));
}

export async function saveEpubCfi(filePath: string, cfi: string): Promise<void> {
  const store = await getStore();
  await store.set(epubCfiKey(filePath), cfi);
  await store.save();
}

// Cached epubjs location table (JSON from Locations.save()), so book-wide % is
// available instantly on reopen instead of regenerating it. Undefined until generated.
export async function getEpubLocations(filePath: string): Promise<string | undefined> {
  const store = await getStore();
  return store.get<string>(epubLocationsKey(filePath));
}

export async function saveEpubLocations(filePath: string, locations: string): Promise<void> {
  const store = await getStore();
  await store.set(epubLocationsKey(filePath), locations);
  await store.save();
}

// Convenience for non-hook callers that only need the page (defaults to 0).
export async function getPageForPath(filePath: string): Promise<number> {
  return (await getSavedPage(filePath)) ?? 0;
}

// Moves all reading-progress keys (page/cascade/bookmarks) from one file path to
// another, deleting the originals. Used when a library file is renamed so its
// reading position survives the path change. No-op for keys that are unset.
export async function migrateReadingProgress(oldPath: string, newPath: string): Promise<void> {
  if (oldPath === newPath) return;
  const store = await getStore();
  const moves: [string, string][] = [
    [pageKey(oldPath), pageKey(newPath)],
    [cascadeKey(oldPath), cascadeKey(newPath)],
    [bookmarksKey(oldPath), bookmarksKey(newPath)],
    [epubCfiKey(oldPath), epubCfiKey(newPath)],
    [epubLocationsKey(oldPath), epubLocationsKey(newPath)],
  ];
  let changed = false;
  for (const [from, to] of moves) {
    const value = await store.get(from);
    if (value === undefined || value === null) continue;
    await store.set(to, value);
    await store.delete(from);
    changed = true;
  }
  if (changed) await store.save();
}

// Reads all page-progress values in a single IPC call.
// Returns a map of filePath → saved page number (entries without a saved page are absent).
export async function getAllPageProgress(): Promise<Map<string, number>> {
  const store = await getStore();
  const all = await store.entries<number>();
  const result = new Map<string, number>();
  for (const [key, value] of all) {
    if (key.endsWith(PAGE_SUFFIX) && typeof value === "number") {
      result.set(key.slice(0, -PAGE_SUFFIX.length), value);
    }
  }
  return result;
}
