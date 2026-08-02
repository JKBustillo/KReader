import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { LoaderResult } from "./types";

// Custom URI scheme served by the Rust `cbz_page_response` handler: one request
// per page, decompressing a single entry out of the archive. Must match
// PAGE_PROTOCOL in src-tauri/src/lib.rs.
const PAGE_PROTOCOL = "kreader";
const ENTRY_QUERY_KEY = "entry";

// Pages are URLs, not blobs: the archive is never loaded into the WebView heap,
// so a multi-GB comic costs the same as a small one.
export async function loadCbz(path: string): Promise<LoaderResult> {
  const names = await invoke<string[]>("list_cbz_pages", { path });
  const base = convertFileSrc(path, PAGE_PROTOCOL);

  const pages = names
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => `${base}?${ENTRY_QUERY_KEY}=${encodeURIComponent(name)}`);

  return { pages };
}
