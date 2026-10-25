import { readDir } from "@tauri-apps/plugin-fs";
import type { LibraryEntry } from "../types/library";
import { basename, normalizePath } from "./folderUtils";
import { absoluteChapter, parseReadingUnit } from "./anilistParse";
import {
  AniListAuthError,
  AniListRetryableError,
  deleteMediaListEntry,
  getMediaProgress,
  isAniListConnected,
  saveMediaListEntry,
  type MediaListEntry,
  type MediaListStatus,
} from "./anilistApi";
import {
  enqueuePendingSync,
  getSeriesLinks,
  setSeriesLink,
  takePendingSyncs,
  type PendingSync,
  type SeriesLink,
} from "./anilistStore";

export const ANILIST_SYNC_EVENT = "anilistSync";

type SyncValues = Omit<MediaListEntry, "id">;

/** Detail of ANILIST_SYNC_EVENT, rendered by AniListToast in the window that read the file. */
export type AniListSyncNotice =
  | { kind: "synced"; mediaId: number; title: string; entryId: number; previous: SyncValues | null; next: SyncValues }
  | { kind: "queued"; title: string }
  | { kind: "authRequired" }
  | { kind: "failed"; title: string };

function notify(notice: AniListSyncNotice) {
  window.dispatchEvent(new CustomEvent<AniListSyncNotice>(ANILIST_SYNC_EVENT, { detail: notice }));
}

const parentDir = (path: string) => {
  const normalized = normalizePath(path);
  return normalized.substring(0, normalized.lastIndexOf("/"));
};

/** The series an entry belongs to: the name of the folder holding the file. */
export const seriesFolderName = (path: string) => basename(parentDir(path));

// Statuses the user set deliberately; syncing only moves progress, never these.
const LOCKED_STATUSES: ReadonlySet<MediaListStatus> = new Set(["PAUSED", "DROPPED", "REPEATING", "COMPLETED"]);

/**
 * Merges what was just read into the viewer's current entry. Progress never
 * goes down; a volume also implies an estimated chapter count when AniList
 * knows both totals; reaching a total completes the series.
 */
function computeNext(
  read: PendingSync,
  totals: { chapters: number | null; volumes: number | null },
  current: MediaListEntry | null,
): SyncValues {
  const { chapters, volumes } = totals;
  const estimatedChapter =
    read.volume !== undefined && chapters && volumes ? Math.floor((read.volume * chapters) / volumes) : 0;
  let progress = Math.max(current?.progress ?? 0, read.chapter ?? 0, estimatedChapter);
  let progressVolumes = Math.max(current?.progressVolumes ?? 0, read.volume ?? 0);
  if (chapters) progress = Math.min(progress, chapters);
  if (volumes) progressVolumes = Math.min(progressVolumes, volumes);

  let status: MediaListStatus = current?.status ?? "CURRENT";
  if (!LOCKED_STATUSES.has(status)) {
    status = "CURRENT";
    const finished = (chapters !== null && progress >= chapters) || (volumes !== null && progressVolumes >= volumes);
    if (finished) {
      status = "COMPLETED";
      if (chapters) progress = chapters;
      if (volumes) progressVolumes = volumes;
    }
  }
  return { status, progress, progressVolumes };
}

const sameValues = (a: SyncValues, b: MediaListEntry | null) =>
  b !== null && a.status === b.status && a.progress === b.progress && a.progressVolumes === b.progressVolumes;

async function pushProgress(read: PendingSync, link: SeriesLink): Promise<void> {
  try {
    const media = await getMediaProgress(link.mediaId);
    if (media.chapters !== link.chapters || media.volumes !== link.volumes) {
      await setSeriesLink(read.folderName, { ...link, chapters: media.chapters, volumes: media.volumes });
    }
    const next = computeNext(read, media, media.entry);
    if (sameValues(next, media.entry)) return;
    const saved = await saveMediaListEntry(link.mediaId, next);
    const previous = media.entry
      ? { status: media.entry.status, progress: media.entry.progress, progressVolumes: media.entry.progressVolumes }
      : null;
    notify({ kind: "synced", mediaId: link.mediaId, title: link.title, entryId: saved.id, previous, next });
  } catch (err) {
    if (err instanceof AniListAuthError) {
      await enqueuePendingSync(read);
      notify({ kind: "authRequired" });
    } else if (err instanceof AniListRetryableError) {
      await enqueuePendingSync(read);
      notify({ kind: "queued", title: link.title });
    } else {
      console.error("[anilist]", err);
      notify({ kind: "failed", title: link.title });
    }
  }
}

async function readUnitsOfFolder(folderName: string, paths: string[]): Promise<PendingSync> {
  const read: PendingSync = { folderName };
  let siblings: string[] | null = null;
  for (const path of paths) {
    const unit = parseReadingUnit(basename(path));
    if (unit.kind === "volume") {
      read.volume = Math.max(read.volume ?? 0, unit.n);
    } else if (unit.kind === "chapter") {
      let n = unit.n;
      if (unit.season !== undefined) {
        siblings ??= (await readDir(parentDir(path))).map((e) => e.name);
        n = absoluteChapter(unit, siblings);
      }
      read.chapter = Math.max(read.chapter ?? 0, n);
    }
  }
  return read;
}

/**
 * Sends the progress implied by newly completed files to AniList: one request
 * per linked series folder (so bulk "mark as read" stays cheap), extras ignored.
 */
export async function syncCompletedEntries(entries: LibraryEntry[]): Promise<void> {
  if (entries.length === 0 || !(await isAniListConnected())) return;
  const links = await getSeriesLinks();

  const pathsByFolder = new Map<string, string[]>();
  for (const entry of entries) {
    const folderName = seriesFolderName(entry.currentPath);
    if (!links[folderName]) continue;
    pathsByFolder.set(folderName, [...(pathsByFolder.get(folderName) ?? []), entry.currentPath]);
  }

  for (const [folderName, paths] of pathsByFolder) {
    const read = await readUnitsOfFolder(folderName, paths);
    if (read.chapter === undefined && read.volume === undefined) continue;
    await pushProgress(read, links[folderName]);
  }
}

/** Retries progress that could not be sent earlier. Unlinked folders are dropped. */
export async function flushPendingSyncs(): Promise<void> {
  if (!(await isAniListConnected())) return;
  const queue = await takePendingSyncs();
  if (queue.length === 0) return;
  const links = await getSeriesLinks();
  for (const read of queue) {
    const link = links[read.folderName];
    if (link) await pushProgress(read, link);
  }
}

/** Thrown by undoSync when the entry changed on AniList after KReader's write. */
export class AniListUndoConflictError extends Error {}

/** Restores the values a "synced" notice replaced, unless AniList moved on since. */
export async function undoSync(notice: Extract<AniListSyncNotice, { kind: "synced" }>): Promise<void> {
  const { entry } = await getMediaProgress(notice.mediaId);
  if (!sameValues(notice.next, entry)) throw new AniListUndoConflictError();
  if (notice.previous) await saveMediaListEntry(notice.mediaId, notice.previous);
  else await deleteMediaListEntry(notice.entryId);
}
