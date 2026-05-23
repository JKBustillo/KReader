import { Store } from "@tauri-apps/plugin-store";
import type { Library, LibraryEntry, ReadingState, Tag } from "../types/library";

const STORE_FILE = ".library.dat";
const LIBRARIES_KEY = "libraries";

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(STORE_FILE));

const entriesKey = (libraryId: string) => `entries:${libraryId}`;

export async function getLibraries(): Promise<Library[]> {
  const store = await getStore();
  return (await store.get<Library[]>(LIBRARIES_KEY)) ?? [];
}

export async function addLibrary(name: string, rootPath: string): Promise<Library> {
  const store = await getStore();
  const libraries = await getLibraries();
  const library: Library = { id: crypto.randomUUID(), name, rootPath };
  await store.set(LIBRARIES_KEY, [...libraries, library]);
  await store.save();
  return library;
}

export async function removeLibrary(id: string): Promise<void> {
  const store = await getStore();
  const libraries = await getLibraries();
  await store.set(LIBRARIES_KEY, libraries.filter((l) => l.id !== id));
  await store.delete(entriesKey(id));
  await store.save();
}

export async function getEntries(libraryId: string): Promise<LibraryEntry[]> {
  const store = await getStore();
  const raw = (await store.get<LibraryEntry[]>(entriesKey(libraryId))) ?? [];
  return raw.map((e) => ({
    ...e,
    readingState: (e.readingState as ReadingState | undefined) ?? "unread",
  }));
}

export async function upsertEntry(entry: LibraryEntry): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(entry.libraryId);
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  await store.set(entriesKey(entry.libraryId), entries);
  await store.save();
}

export async function upsertEntries(libraryId: string, batch: LibraryEntry[]): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  for (const entry of batch) {
    const idx = entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) entries[idx] = entry;
    else entries.push(entry);
  }
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}

export async function removeEntry(id: string, libraryId: string): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  await store.set(entriesKey(libraryId), entries.filter((e) => e.id !== id));
  await store.save();
}

export async function updateEntryPath(id: string, libraryId: string, newPath: string): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.currentPath = newPath;
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}

export async function setFavorite(id: string, libraryId: string, value: boolean): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.isFavorite = value;
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}

export async function setReadingState(
  id: string,
  libraryId: string,
  state: ReadingState,
): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.readingState = state;
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}

export async function setCustomTags(id: string, libraryId: string, tags: Tag[]): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.customTags = tags;
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}

export async function setRating(id: string, libraryId: string, rating: number | undefined): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.rating = rating;
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}

export async function setLastOpenedAt(id: string, libraryId: string, timestamp: number): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.lastOpenedAt = timestamp;
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}

export async function setTotalPages(id: string, libraryId: string, total: number): Promise<void> {
  const store = await getStore();
  const entries = await getEntries(libraryId);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.totalPages = total;
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}

export async function exportLibraryData(): Promise<{ libraries: Library[]; entries: Record<string, LibraryEntry[]> }> {
  const libraries = await getLibraries();
  const entries: Record<string, LibraryEntry[]> = {};
  for (const lib of libraries) {
    entries[lib.id] = await getEntries(lib.id);
  }
  return { libraries, entries };
}

export async function importLibraryData(data: { libraries: Library[]; entries: Record<string, LibraryEntry[]> }): Promise<void> {
  const store = await getStore();
  await store.set(LIBRARIES_KEY, data.libraries);
  for (const [libId, libEntries] of Object.entries(data.entries)) {
    await store.set(entriesKey(libId), libEntries);
  }
  await store.save();
}

export async function batchSetCustomTags(
  libraryId: string,
  updates: { id: string; tags: Tag[] }[],
): Promise<void> {
  if (updates.length === 0) return;
  const store = await getStore();
  const entries = await getEntries(libraryId);
  for (const { id, tags } of updates) {
    const entry = entries.find((e) => e.id === id);
    if (entry) entry.customTags = tags;
  }
  await store.set(entriesKey(libraryId), entries);
  await store.save();
}
