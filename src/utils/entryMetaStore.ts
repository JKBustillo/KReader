import { Store } from "@tauri-apps/plugin-store";
import type { ReadingState, Tag } from "../types/library";

const STORE_FILE = ".entry-meta.dat";
const META_KEY = "entry-meta";

/**
 * User-authored metadata that "sticks to the file", keyed by entry id
 * (`{filename}::{sizeBytes}`) and independent of any library. This is what lets
 * tags/favorite/rating/readingState survive a library delete + re-add. All
 * fields are optional so partial write-through merges and migration backfills
 * can coexist; the library entry remains the live mirror used by the UI.
 */
export type EntryMeta = {
  customTags?: Tag[];
  isFavorite?: boolean;
  rating?: number;
  readingState?: ReadingState;
};

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(STORE_FILE));

async function readAll(store: Store): Promise<Record<string, EntryMeta>> {
  return (await store.get<Record<string, EntryMeta>>(META_KEY)) ?? {};
}

export async function getEntryMetaMap(): Promise<Map<string, EntryMeta>> {
  const store = await getStore();
  return new Map(Object.entries(await readAll(store)));
}

export async function getAllEntryMeta(): Promise<Record<string, EntryMeta>> {
  const store = await getStore();
  return readAll(store);
}

export async function replaceAllEntryMeta(records: Record<string, EntryMeta>): Promise<void> {
  const store = await getStore();
  await store.set(META_KEY, records);
  await store.save();
}

/** Removes the records for `ids` (used when "forgetting" a deleted library). */
export async function deleteEntryMeta(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const store = await getStore();
  const all = await readAll(store);
  let changed = false;
  for (const id of ids) {
    if (id in all) {
      delete all[id];
      changed = true;
    }
  }
  if (changed) {
    await store.set(META_KEY, all);
    await store.save();
  }
}

/**
 * Moves the meta record from `oldId` to `newId` (used when a file is renamed,
 * which changes its id). Merges onto any existing record at `newId` and deletes
 * the old key. No-op if there is no record at `oldId`.
 */
export async function renameEntryMeta(oldId: string, newId: string): Promise<void> {
  if (oldId === newId) return;
  const store = await getStore();
  const all = await readAll(store);
  if (!(oldId in all)) return;
  all[newId] = { ...all[newId], ...all[oldId] };
  delete all[oldId];
  await store.set(META_KEY, all);
  await store.save();
}

/** Merges a partial patch into the record for `id` (read-modify-write). */
export async function setEntryMetaFields(id: string, patch: EntryMeta): Promise<void> {
  const store = await getStore();
  const all = await readAll(store);
  all[id] = { ...all[id], ...patch };
  await store.set(META_KEY, all);
  await store.save();
}

/** Single read-modify-write for many ids, to avoid concurrent-write races. */
export async function batchSetEntryMeta(updates: { id: string; meta: EntryMeta }[]): Promise<void> {
  if (updates.length === 0) return;
  const store = await getStore();
  const all = await readAll(store);
  for (const { id, meta } of updates) {
    all[id] = { ...all[id], ...meta };
  }
  await store.set(META_KEY, all);
  await store.save();
}
