import { Store } from "@tauri-apps/plugin-store";
import type { MediaListEdit, MediaListEntry, ScoreFormat } from "./anilistApi";

const STORE_FILE = ".anilist.dat";
const LINKS_KEY = "links";
const QUEUE_KEY = "queue";
const EDITS_KEY = "edits";
const SCORE_FORMAT_KEY = "score-format";

/** What the series panel shows besides the link basics, cached so it also works offline. */
export type SeriesInfo = {
  coverLargeUrl?: string;
  coverExtraLargeUrl?: string;
  format: string | null;
  year: number | null;
  siteUrl: string;
  genres: string[];
  description: string | null;
};

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
  /** Filled on the first successful fetch; absent on links made before the series panel. */
  info?: SeriesInfo;
  /**
   * Last known state of the viewer's entry (null = not on their list), with any
   * queued edits already applied, so the panel can show and edit it offline.
   */
  entry?: MediaListEntry | null;
};

/** Progress that could not be sent yet (offline, rate-limited, expired token). */
export type PendingSync = {
  folderName: string;
  chapter?: number;
  volume?: number;
};

/** A panel edit that could not be sent yet: only the fields the user changed. */
export type PendingEdit = {
  folderName: string;
  /** The media the edit was made for; it is dropped if the folder is relinked to another one. */
  mediaId: number;
  edit: MediaListEdit;
};

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= Store.load(STORE_FILE));

// Serializes every read-modify-write below: sync, the panel and the queue flush
// run concurrently, and two interleaved writers would drop each other's changes
// (or resurrect an unlinked folder). Covers this window only; other windows
// rarely write here at the same moment.
let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

async function readKey<T>(key: string, fallback: T): Promise<T> {
  const store = await getStore();
  return (await store.get<T>(key)) ?? fallback;
}

async function writeKey(key: string, value: unknown): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}

export const getSeriesLinks = () => readKey<Record<string, SeriesLink>>(LINKS_KEY, {});

export const replaceSeriesLinks = (links: Record<string, SeriesLink>) => exclusive(() => writeKey(LINKS_KEY, links));

/**
 * Links (or relinks) a folder; `undefined` removes the link. Queued panel edits
 * for the folder are dropped unless it stays linked to the same media.
 */
export function setSeriesLink(folderName: string, link: SeriesLink | undefined): Promise<void> {
  return exclusive(async () => {
    const links = await getSeriesLinks();
    const sameMedia = link !== undefined && links[folderName]?.mediaId === link.mediaId;
    if (link) links[folderName] = link;
    else delete links[folderName];
    await writeKey(LINKS_KEY, links);
    if (!sameMedia) {
      const edits = await readKey<PendingEdit[]>(EDITS_KEY, []);
      const kept = edits.filter((e) => e.folderName !== folderName);
      if (kept.length !== edits.length) await writeKey(EDITS_KEY, kept);
    }
  });
}

/** Merges `patch` into the stored link. No-op (undefined) if the folder was unlinked. */
export function updateSeriesLink(folderName: string, patch: Partial<SeriesLink>): Promise<SeriesLink | undefined> {
  return exclusive(async () => {
    const links = await getSeriesLinks();
    const current = links[folderName];
    if (!current) return undefined;
    const updated = { ...current, ...patch };
    links[folderName] = updated;
    await writeKey(LINKS_KEY, links);
    return updated;
  });
}

export const getScoreFormat = () => readKey<ScoreFormat | undefined>(SCORE_FORMAT_KEY, undefined);

export const setScoreFormat = (format: ScoreFormat) => exclusive(() => writeKey(SCORE_FORMAT_KEY, format));

const maxDefined = (a?: number, b?: number) =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

/** Queues progress for a folder, merging with any pending item by taking the max. */
export function enqueuePendingSync(item: PendingSync): Promise<void> {
  return exclusive(async () => {
    const queue = await readKey<PendingSync[]>(QUEUE_KEY, []);
    const existing = queue.find((q) => q.folderName === item.folderName);
    if (existing) {
      existing.chapter = maxDefined(existing.chapter, item.chapter);
      existing.volume = maxDefined(existing.volume, item.volume);
    } else {
      queue.push(item);
    }
    await writeKey(QUEUE_KEY, queue);
  });
}

/** Removes and returns the whole queue; callers re-enqueue whatever still fails. */
export function takePendingSyncs(): Promise<PendingSync[]> {
  return exclusive(async () => {
    const queue = await readKey<PendingSync[]>(QUEUE_KEY, []);
    if (queue.length > 0) await writeKey(QUEUE_KEY, []);
    return queue;
  });
}

/**
 * Queues an edit for a folder; a later edit of the same field replaces the
 * earlier one. An edit queued for another media (folder relinked) is replaced.
 */
export function enqueuePendingEdit(item: PendingEdit): Promise<void> {
  return exclusive(async () => {
    const edits = await readKey<PendingEdit[]>(EDITS_KEY, []);
    const existing = edits.find((e) => e.folderName === item.folderName);
    if (existing && existing.mediaId === item.mediaId) existing.edit = { ...existing.edit, ...item.edit };
    else if (existing) Object.assign(existing, item);
    else edits.push(item);
    await writeKey(EDITS_KEY, edits);
  });
}

/** The edit still queued for a folder, if any (not removed). */
export async function getPendingEdit(folderName: string): Promise<PendingEdit | undefined> {
  const edits = await readKey<PendingEdit[]>(EDITS_KEY, []);
  return edits.find((e) => e.folderName === folderName);
}

/**
 * Removes and returns the queued edits (all, or only `folderName`'s); callers
 * re-enqueue whatever still fails.
 */
export function takePendingEdits(folderName?: string): Promise<PendingEdit[]> {
  return exclusive(async () => {
    const edits = await readKey<PendingEdit[]>(EDITS_KEY, []);
    const taken = folderName === undefined ? edits : edits.filter((e) => e.folderName === folderName);
    if (taken.length > 0) await writeKey(EDITS_KEY, edits.filter((e) => !taken.includes(e)));
    return taken;
  });
}
