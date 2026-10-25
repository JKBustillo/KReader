import { readDir } from "@tauri-apps/plugin-fs";
import type { LibraryEntry } from "../types/library";
import { basename, normalizePath } from "./folderUtils";
import { absoluteChapter, parseReadingUnit } from "./anilistParse";
import {
  AniListAuthError,
  AniListRetryableError,
  DEFAULT_SCORE_FORMAT,
  deleteMediaListEntry,
  getMediaProgress,
  getSeriesDetails,
  isAniListConnected,
  saveMediaListEntry,
  type MediaListEdit,
  type MediaListEntry,
  type MediaListStatus,
  type ScoreFormat,
} from "./anilistApi";
import {
  enqueuePendingEdit,
  enqueuePendingSync,
  getPendingEdit,
  getScoreFormat,
  getSeriesLinks,
  setScoreFormat,
  takePendingEdits,
  takePendingSyncs,
  updateSeriesLink,
  type PendingEdit,
  type PendingSync,
  type SeriesLink,
} from "./anilistStore";

export const ANILIST_SYNC_EVENT = "anilistSync";

type SyncValues = Pick<MediaListEntry, "status" | "progress" | "progressVolumes">;

/** Detail of ANILIST_SYNC_EVENT, rendered by AniListToast in the window that read the file. */
export type AniListSyncNotice =
  | {
      kind: "synced";
      folderName: string;
      mediaId: number;
      title: string;
      entryId: number;
      previous: SyncValues | null;
      next: SyncValues;
    }
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

const sameEntry = (a: MediaListEntry | null | undefined, b: MediaListEntry | null | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function pushProgress(read: PendingSync, link: SeriesLink): Promise<void> {
  try {
    // Hand edits queued for this series go first; sent after this read, a flush
    // could lower the progress it just raised.
    await retryPendingEdits(await takePendingEdits(read.folderName), { [read.folderName]: link });
    const media = await getMediaProgress(link.mediaId);
    const next = computeNext(read, media, media.entry);
    const unchanged = sameValues(next, media.entry);
    const saved = unchanged ? media.entry : await saveMediaListEntry(link.mediaId, next);
    if (media.chapters !== link.chapters || media.volumes !== link.volumes || !sameEntry(saved, link.entry)) {
      await updateSeriesLink(read.folderName, { chapters: media.chapters, volumes: media.volumes, entry: saved });
    }
    if (unchanged || !saved) return;
    const previous = media.entry
      ? { status: media.entry.status, progress: media.entry.progress, progressVolumes: media.entry.progressVolumes }
      : null;
    notify({
      kind: "synced",
      folderName: read.folderName,
      mediaId: link.mediaId,
      title: link.title,
      entryId: saved.id,
      previous,
      next,
    });
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

const isRetryLater = (err: unknown) => err instanceof AniListAuthError || err instanceof AniListRetryableError;

async function sendEdit(folderName: string, mediaId: number, edit: MediaListEdit): Promise<void> {
  const saved = await saveMediaListEntry(mediaId, edit);
  await updateSeriesLink(folderName, { entry: saved });
}

/**
 * Sends queued panel edits; the ones that still can't go out are queued again.
 * Edits for an unlinked folder, or one relinked to another media, are dropped.
 */
async function retryPendingEdits(edits: PendingEdit[], links: Record<string, SeriesLink>): Promise<void> {
  for (const pending of edits) {
    const link = links[pending.folderName];
    if (!link || link.mediaId !== pending.mediaId) continue;
    try {
      await sendEdit(pending.folderName, link.mediaId, pending.edit);
    } catch (err) {
      if (isRetryLater(err)) {
        await enqueuePendingEdit(pending);
      } else {
        console.error("[anilist edit]", err);
        notify({ kind: "failed", title: link.title });
      }
    }
  }
}

/**
 * Retries what could not be sent earlier: panel edits first, then read progress,
 * so a later read can still raise progress over a value set by hand (never lower
 * it). Unlinked folders are dropped.
 */
export async function flushPendingSyncs(): Promise<void> {
  if (!(await isAniListConnected())) return;
  const links = await getSeriesLinks();
  await retryPendingEdits(await takePendingEdits(), links);
  for (const read of await takePendingSyncs()) {
    const link = links[read.folderName];
    if (link) await pushProgress(read, link);
  }
}

/** What the series panel shows. `stale` is set when AniList couldn't be reached and `link` is the cached copy. */
export type SeriesPanelData = {
  link: SeriesLink;
  scoreFormat: ScoreFormat;
  stale: "offline" | "authRequired" | null;
};

/**
 * The panel data cached from an earlier fetch, so a series opened before shows
 * at once while loadSeriesPanel refreshes it. Null if it was never fetched.
 */
export async function getCachedSeriesPanel(folderName: string): Promise<SeriesPanelData | null> {
  const [link, scoreFormat] = await Promise.all([
    getSeriesLinks().then((links) => links[folderName]),
    getScoreFormat(),
  ]);
  if (!link?.info || !scoreFormat) return null;
  return { link, scoreFormat, stale: null };
}

/**
 * Fresh series details and list entry for the panel, cached into the link for
 * offline use. Edits still queued for this folder are sent first, so the panel
 * never shows (and then overwrites) values older than the user's own edits.
 */
export async function loadSeriesPanel(folderName: string): Promise<SeriesPanelData> {
  const links = await getSeriesLinks();
  const link = links[folderName];
  if (!link) throw new Error(`[anilist] ${folderName} is not linked`);
  if (await isAniListConnected()) await retryPendingEdits(await takePendingEdits(folderName), links);

  try {
    const details = await getSeriesDetails(link.mediaId);
    await setScoreFormat(details.scoreFormat);
    // An edit that failed to go out again (e.g. rate-limited) is still queued: show it, as the offline cache does.
    const stillQueued = await getPendingEdit(folderName);
    const entry = stillQueued?.mediaId === link.mediaId ? applyEdit(details.entry, stillQueued.edit) : details.entry;
    const updated = await updateSeriesLink(folderName, {
      title: details.title,
      coverUrl: details.coverUrl ?? link.coverUrl,
      chapters: details.chapters,
      volumes: details.volumes,
      info: {
        coverLargeUrl: details.coverLargeUrl,
        coverExtraLargeUrl: details.coverExtraLargeUrl,
        format: details.format,
        year: details.year,
        siteUrl: details.siteUrl,
        genres: details.genres,
        description: details.description,
      },
      entry,
    });
    return { link: updated ?? link, scoreFormat: details.scoreFormat, stale: null };
  } catch (err) {
    if (!isRetryLater(err)) throw err;
    // The cached link already has queued edits applied (see saveSeriesEdit).
    const cached = (await getSeriesLinks())[folderName] ?? link;
    return {
      link: cached,
      scoreFormat: (await getScoreFormat()) ?? DEFAULT_SCORE_FORMAT,
      stale: err instanceof AniListAuthError ? "authRequired" : "offline",
    };
  }
}

// Status a series gets when an edit adds it to the list without picking one (same as reading does).
const NEW_ENTRY_STATUS: MediaListStatus = "CURRENT";
// Placeholder id for an entry that only exists in the offline queue so far.
const UNSAVED_ENTRY_ID = 0;

function applyEdit(entry: MediaListEntry | null, edit: MediaListEdit): MediaListEntry {
  const base = entry ?? { id: UNSAVED_ENTRY_ID, status: NEW_ENTRY_STATUS, progress: 0, progressVolumes: 0, score: 0 };
  return { ...base, ...edit };
}

/**
 * Saves a panel edit (only the changed fields). When AniList can't be reached
 * it is queued and applied to the cached entry so the panel reflects it offline.
 * Other errors are thrown for the panel to show.
 */
export async function saveSeriesEdit(folderName: string, link: SeriesLink, edit: MediaListEdit): Promise<void> {
  const cachedEntry = (await getSeriesLinks())[folderName]?.entry ?? null;
  // A series that isn't on the list yet needs a status for AniList to create the entry.
  const toSend = cachedEntry || edit.status ? edit : { status: NEW_ENTRY_STATUS, ...edit };
  try {
    await sendEdit(folderName, link.mediaId, toSend);
  } catch (err) {
    if (!isRetryLater(err)) throw err;
    await enqueuePendingEdit({ folderName, mediaId: link.mediaId, edit: toSend });
    await updateSeriesLink(folderName, { entry: applyEdit(cachedEntry, toSend) });
    notify(err instanceof AniListAuthError ? { kind: "authRequired" } : { kind: "queued", title: link.title });
  }
}

/** Thrown by undoSync when the entry changed on AniList after KReader's write. */
export class AniListUndoConflictError extends Error {}

/** Restores the values a "synced" notice replaced, unless AniList moved on since. */
export async function undoSync(notice: Extract<AniListSyncNotice, { kind: "synced" }>): Promise<void> {
  const { entry } = await getMediaProgress(notice.mediaId);
  if (!sameValues(notice.next, entry)) throw new AniListUndoConflictError();
  let restored: MediaListEntry | null = null;
  if (notice.previous) restored = await saveMediaListEntry(notice.mediaId, notice.previous);
  else await deleteMediaListEntry(notice.entryId);
  await updateSeriesLink(notice.folderName, { entry: restored });
}
