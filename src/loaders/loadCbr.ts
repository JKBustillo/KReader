import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { LoaderResult } from "./types";

// Mirrors the Rust ExtractedArchive struct.
type ExtractedArchive = { dir: string; pages: string[] };

// RAR has no random access to entries, so the archive is unpacked once to a
// cache directory (in Rust, page by page, without buffering it in memory) and
// the pages are then read from disk through the asset protocol. The caller owns
// `tempDir` and deletes it when the file is closed.
export async function loadCbr(path: string): Promise<LoaderResult> {
  const { dir, pages } = await invoke<ExtractedArchive>("extract_cbr_to_dir", { path });
  return { pages: pages.map((pagePath) => convertFileSrc(pagePath)), tempDir: dir };
}
