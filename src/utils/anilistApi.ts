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

export type MediaListStatus = "CURRENT" | "PLANNING" | "COMPLETED" | "DROPPED" | "PAUSED" | "REPEATING";

export type MediaListEntry = {
  id: number;
  status: MediaListStatus;
  progress: number;
  progressVolumes: number;
};

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

const MEDIA_PROGRESS_QUERY = `query ($id: Int) {
  Media(id: $id) {
    chapters
    volumes
    mediaListEntry { id status progress progressVolumes }
  }
}`;

/** Current totals plus the viewer's list entry for `mediaId` (null if not on their list). */
export async function getMediaProgress(mediaId: number): Promise<MediaProgress> {
  const data = await authedRequest<{
    Media: { chapters: number | null; volumes: number | null; mediaListEntry: MediaListEntry | null };
  }>(MEDIA_PROGRESS_QUERY, { id: mediaId });
  return { chapters: data.Media.chapters, volumes: data.Media.volumes, entry: data.Media.mediaListEntry };
}

const SAVE_ENTRY_MUTATION = `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, progressVolumes: $progressVolumes) {
    id status progress progressVolumes
  }
}`;

export async function saveMediaListEntry(
  mediaId: number,
  values: Omit<MediaListEntry, "id">,
): Promise<MediaListEntry> {
  const data = await authedRequest<{ SaveMediaListEntry: MediaListEntry }>(SAVE_ENTRY_MUTATION, {
    mediaId,
    ...values,
  });
  return data.SaveMediaListEntry;
}

const DELETE_ENTRY_MUTATION = `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`;

export async function deleteMediaListEntry(entryId: number): Promise<void> {
  await authedRequest(DELETE_ENTRY_MUTATION, { id: entryId });
}
