import { readDir } from "@tauri-apps/plugin-fs";
import { dirname } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

import { IMAGE_EXTS } from "../loaders/types";
import type { LibraryEntry } from "../types/library";

const IMAGE_EXTS_SET = new Set<string>(IMAGE_EXTS);

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export async function countPages(entry: LibraryEntry): Promise<number | null> {
  const ext = fileExt(entry.filename);

  if (ext === "cbz" || ext === "zip") {
    const count = await invoke<number>("count_cbz_pages", { path: entry.currentPath });
    return count > 0 ? count : null;
  }

  if (ext === "pdf") {
    const count = await invoke<number>("count_pdf_pages", { path: entry.currentPath });
    return count > 0 ? count : null;
  }

  if (ext === "cbr" || ext === "rar") {
    const count = await invoke<number>("count_cbr_pages", { path: entry.currentPath });
    return count > 0 ? count : null;
  }

  if (IMAGE_EXTS_SET.has(ext)) {
    const dir = await dirname(entry.currentPath);
    const files = await readDir(dir);
    const count = files.filter((f) => f.name && IMAGE_EXTS_SET.has(fileExt(f.name))).length;
    return count > 0 ? count : null;
  }

  return null;
}
