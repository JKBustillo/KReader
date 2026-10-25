import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = ".anilist.dat";
const LINKS_KEY = "links";
const QUEUE_KEY = "queue";

/**
 * A series folder linked to an AniList media, keyed by the folder's *name*
 * (not its path) so the link survives moving the folder (e.g. into "- Leído/")
 * and covers files added to it later. Totals are cached from the last fetch and
 * may be null while a series is still releasing.
 */
export type SeriesLink = {
  mediaId: number;
  title: string;
  coverUrl?: string;
  chapters: number | null;
  volumes: number | null;
};

/** Progress that could not be sent yet (offline, rate-limited, expired token). */
export type PendingSync = {
  folderName: string;
  chapter?: number;
  volume?: number;
};

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(STORE_FILE));

export async function getSeriesLinks(): Promise<Record<string, SeriesLink>> {
  const store = await getStore();
  return (await store.get<Record<string, SeriesLink>>(LINKS_KEY)) ?? {};
}

export async function replaceSeriesLinks(links: Record<string, SeriesLink>): Promise<void> {
  const store = await getStore();
  await store.set(LINKS_KEY, links);
  await store.save();
}

/** Links (or relinks) a folder; `undefined` removes the link. */
export async function setSeriesLink(folderName: string, link: SeriesLink | undefined): Promise<void> {
  const links = await getSeriesLinks();
  if (link) links[folderName] = link;
  else delete links[folderName];
  await replaceSeriesLinks(links);
}

export async function getPendingSyncs(): Promise<PendingSync[]> {
  const store = await getStore();
  return (await store.get<PendingSync[]>(QUEUE_KEY)) ?? [];
}

async function savePendingSyncs(queue: PendingSync[]): Promise<void> {
  const store = await getStore();
  await store.set(QUEUE_KEY, queue);
  await store.save();
}

const maxDefined = (a?: number, b?: number) =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

/** Queues progress for a folder, merging with any pending item by taking the max. */
export async function enqueuePendingSync(item: PendingSync): Promise<void> {
  const queue = await getPendingSyncs();
  const existing = queue.find((q) => q.folderName === item.folderName);
  if (existing) {
    existing.chapter = maxDefined(existing.chapter, item.chapter);
    existing.volume = maxDefined(existing.volume, item.volume);
  } else {
    queue.push(item);
  }
  await savePendingSyncs(queue);
}

/** Removes and returns the whole queue; callers re-enqueue whatever still fails. */
export async function takePendingSyncs(): Promise<PendingSync[]> {
  const queue = await getPendingSyncs();
  if (queue.length > 0) await savePendingSyncs([]);
  return queue;
}
