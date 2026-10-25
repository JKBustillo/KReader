import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

const GRAPHQL_URL = "https://graphql.anilist.co";
const ANILIST_CLIENT_ID = 54938;
// Implicit grant with AniList's "pin" redirect: the token is shown on the page
// for the user to paste back, so no deep link or localhost listener is needed.
const AUTHORIZE_URL = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=token`;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
const INVALID_TOKEN_MESSAGE = "invalid token";
const SEARCH_PAGE_SIZE = 10;

export const MEDIA_LIST_STATUSES = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"] as const;
export type MediaListStatus = (typeof MEDIA_LIST_STATUSES)[number];

export type ScoreFormat = "POINT_100" | "POINT_10_DECIMAL" | "POINT_10" | "POINT_5" | "POINT_3";

export type MediaListEntry = {
  id: number;
  status: MediaListStatus;
  progress: number;
  progressVolumes: number;
  /** Always the raw 0-100 value (0 = unscored), whatever the account's score format. */
  score: number;
};

/** Fields to change on a list entry; omitted fields are left as they are on AniList. */
export type MediaListEdit = Partial<Omit<MediaListEntry, "id">>;

export type MediaSearchResult = {
  id: number;
  title: string;
  coverUrl?: string;
  format: string | null;
  year: number | null;
  chapters: number | null;
  volumes: number | null;
};

export type MediaProgress = {
  chapters: number | null;
  volumes: number | null;
  entry: MediaListEntry | null;
};

export type SeriesDetails = MediaProgress & {
  title: string;
  coverUrl?: string;
  coverLargeUrl?: string;
  coverExtraLargeUrl?: string;
  format: string | null;
  year: number | null;
  siteUrl: string;
  genres: string[];
  /** Plain text (AniList's markup stripped); null when AniList has none. */
  description: string | null;
  scoreFormat: ScoreFormat;
};

/** Token missing, expired (they last 1 year) or revoked: the user must reconnect. */
export class AniListAuthError extends Error {}
/** Network down or rate-limited: safe to retry later. */
export class AniListRetryableError extends Error {}

let cachedToken: string | null | undefined;

async function getToken(): Promise<string | null> {
  if (cachedToken === undefined) cachedToken = await invoke<string | null>("anilist_token_get");
  return cachedToken;
}

export async function isAniListConnected(): Promise<boolean> {
  return (await getToken()) !== null;
}

export async function openAniListAuthorization(): Promise<void> {
  await openUrl(AUTHORIZE_URL);
}

async function request<T>(query: string, variables: Record<string, unknown>, token: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new AniListRetryableError(String(err));
  }
  if (res.status === HTTP_TOO_MANY_REQUESTS) throw new AniListRetryableError(res.statusText);
  // A non-JSON body means an outage page from AniList's edge, not a query error.
  const body = (await res.json().catch(() => {
    throw new AniListRetryableError(res.statusText);
  })) as { data?: T; errors?: { message: string; status?: number }[] };
  if (body.errors?.length) {
    const authFailed =
      res.status === HTTP_UNAUTHORIZED ||
      body.errors.some((e) => e.status === HTTP_UNAUTHORIZED || e.message.toLowerCase() === INVALID_TOKEN_MESSAGE);
    const message = body.errors.map((e) => e.message).join("; ");
    throw authFailed ? new AniListAuthError(message) : new Error(message);
  }
  return body.data as T;
}

async function authedRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await getToken();
  if (!token) throw new AniListAuthError("not connected");
  return request<T>(query, variables, token);
}

const VIEWER_QUERY = `query { Viewer { name } }`;

/** Validates `token` against AniList and, if it works, stores it in the OS credential store. */
export async function connectAniList(token: string): Promise<string> {
  const trimmed = token.trim();
  const data = await request<{ Viewer: { name: string } }>(VIEWER_QUERY, {}, trimmed);
  await invoke("anilist_token_set", { token: trimmed });
  cachedToken = trimmed;
  return data.Viewer.name;
}

export async function disconnectAniList(): Promise<void> {
  await invoke("anilist_token_delete");
  cachedToken = null;
}

export async function getViewerName(): Promise<string> {
  const data = await authedRequest<{ Viewer: { name: string } }>(VIEWER_QUERY, {});
  return data.Viewer.name;
}

const SEARCH_QUERY = `query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: MANGA) {
      id
      title { userPreferred }
      coverImage { medium }
      format
      startDate { year }
      chapters
      volumes
    }
  }
}`;

type RawMedia = {
  id: number;
  title: { userPreferred: string };
  coverImage: { medium: string | null } | null;
  format: string | null;
  startDate: { year: number | null } | null;
  chapters: number | null;
  volumes: number | null;
};

export async function searchManga(search: string): Promise<MediaSearchResult[]> {
  const data = await request<{ Page: { media: RawMedia[] } }>(
    SEARCH_QUERY,
    { search, perPage: SEARCH_PAGE_SIZE },
    await getToken(),
  );
  return data.Page.media.map((m) => ({
    id: m.id,
    title: m.title.userPreferred,
    coverUrl: m.coverImage?.medium ?? undefined,
    format: m.format,
    year: m.startDate?.year ?? null,
    chapters: m.chapters,
    volumes: m.volumes,
  }));
}

// score(format: POINT_100) reads the raw value, so KReader never converts between formats on read.
const ENTRY_FIELDS = "id status progress progressVolumes score(format: POINT_100)";

const MEDIA_PROGRESS_QUERY = `query ($id: Int) {
  Media(id: $id) {
    chapters
    volumes
    mediaListEntry { ${ENTRY_FIELDS} }
  }
}`;

/** Current totals plus the viewer's list entry for `mediaId` (null if not on their list). */
export async function getMediaProgress(mediaId: number): Promise<MediaProgress> {
  const data = await authedRequest<{
    Media: { chapters: number | null; volumes: number | null; mediaListEntry: MediaListEntry | null };
  }>(MEDIA_PROGRESS_QUERY, { id: mediaId });
  return { chapters: data.Media.chapters, volumes: data.Media.volumes, entry: data.Media.mediaListEntry };
}

const SERIES_DETAILS_QUERY = `query ($id: Int) {
  Media(id: $id) {
    title { userPreferred }
    coverImage { medium large extraLarge }
    format
    startDate { year }
    chapters
    volumes
    siteUrl
    genres
    description(asHtml: false)
    mediaListEntry { ${ENTRY_FIELDS} }
  }
  Viewer { mediaListOptions { scoreFormat } }
}`;

type RawSeriesDetails = Omit<RawMedia, "coverImage"> & {
  coverImage: { medium: string | null; large: string | null; extraLarge: string | null } | null;
  siteUrl: string;
  genres: string[] | null;
  description: string | null;
  mediaListEntry: MediaListEntry | null;
};

export const DEFAULT_SCORE_FORMAT: ScoreFormat = "POINT_10";
const LINE_BREAK_TAG_RE = /<br\s*\/?>/gi;
const EXTRA_BLANK_LINES_RE = /\n{3,}/g;

/**
 * AniList descriptions carry HTML even with asHtml:false (<br>, <i>, <b>). They
 * become plain text (rendered as text, never as markup): DOMParser drops the tags
 * and decodes entities without running scripts or loading resources.
 */
function descriptionToText(description: string): string {
  const withBreaks = description.replace(LINE_BREAK_TAG_RE, "\n");
  const text = new DOMParser().parseFromString(withBreaks, "text/html").body.textContent ?? "";
  return text.replace(EXTRA_BLANK_LINES_RE, "\n\n").trim();
}

/** Everything the series panel shows, plus the viewer's entry and score format, in one request. */
export async function getSeriesDetails(mediaId: number): Promise<SeriesDetails> {
  const data = await authedRequest<{
    Media: RawSeriesDetails;
    Viewer: { mediaListOptions: { scoreFormat: ScoreFormat } | null };
  }>(SERIES_DETAILS_QUERY, { id: mediaId });
  const m = data.Media;
  return {
    title: m.title.userPreferred,
    coverUrl: m.coverImage?.medium ?? undefined,
    coverLargeUrl: m.coverImage?.large ?? undefined,
    coverExtraLargeUrl: m.coverImage?.extraLarge ?? undefined,
    format: m.format,
    year: m.startDate?.year ?? null,
    chapters: m.chapters,
    volumes: m.volumes,
    siteUrl: m.siteUrl,
    genres: m.genres ?? [],
    description: m.description ? descriptionToText(m.description) : null,
    entry: m.mediaListEntry,
    scoreFormat: data.Viewer.mediaListOptions?.scoreFormat ?? DEFAULT_SCORE_FORMAT,
  };
}

const SAVE_ENTRY_MUTATION = `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int, $scoreRaw: Int) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, progressVolumes: $progressVolumes, scoreRaw: $scoreRaw) {
    ${ENTRY_FIELDS}
  }
}`;

/** Creates or updates the viewer's entry. Only the fields present in `edit` are changed. */
export async function saveMediaListEntry(mediaId: number, edit: MediaListEdit): Promise<MediaListEntry> {
  const { score, ...rest } = edit;
  // Undefined variables are dropped by JSON.stringify, so AniList leaves those fields alone.
  const data = await authedRequest<{ SaveMediaListEntry: MediaListEntry }>(SAVE_ENTRY_MUTATION, {
    mediaId,
    ...rest,
    scoreRaw: score,
  });
  return data.SaveMediaListEntry;
}

const DELETE_ENTRY_MUTATION = `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`;

export async function deleteMediaListEntry(entryId: number): Promise<void> {
  await authedRequest(DELETE_ENTRY_MUTATION, { id: entryId });
}
