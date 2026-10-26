import type { LibraryEntry } from "../types/library";
import { normalizePath } from "./folderUtils";

/** "continue" resumes a started file, "start" opens one not begun yet. */
export type ContinueTarget = { entry: LibraryEntry; mode: "continue" | "start" };

const folderOf = (path: string) => {
  const normalized = normalizePath(path);
  return normalized.substring(0, normalized.lastIndexOf("/"));
};

// Within a folder: filename order, numeric ("Cap 2" before "Cap 10"), like Ctrl+Arrow (which also skips other formats).
const byPath = (a: LibraryEntry, b: LibraryEntry) =>
  a.currentPath.localeCompare(b.currentPath, undefined, { numeric: true });

/**
 * What "Continue" opens among `entries`: the most recently opened file while it's unfinished;
 * once it's completed, the first unfinished file after it in its folder. A set never opened starts
 * at its first unfinished file. Null when there's nothing left to read.
 */
export function pickContinueTarget(entries: LibraryEntry[]): ContinueTarget | null {
  let last: LibraryEntry | undefined;
  for (const entry of entries) {
    if (entry.lastOpenedAt !== undefined && entry.lastOpenedAt > (last?.lastOpenedAt ?? -1)) last = entry;
  }
  if (last && last.readingState !== "completed") return { entry: last, mode: "continue" };

  let candidates = entries;
  if (last) {
    const folder = folderOf(last.currentPath);
    candidates = entries.filter((e) => folderOf(e.currentPath) === folder);
  }
  const ordered = [...candidates].sort(byPath);
  const from = last ? ordered.indexOf(last) + 1 : 0;
  const next = ordered.slice(from).find((e) => e.readingState !== "completed");
  if (!next) return null;
  return { entry: next, mode: next.readingState === "in_progress" ? "continue" : "start" };
}
