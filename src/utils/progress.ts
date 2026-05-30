import type { LibraryEntry } from "../types/library";

/** Max percent shown while a book is still in progress — never 100% until completed. */
export const PROGRESS_INCOMPLETE_CAP = 99;

/** Reading-state → CSS color var, for the progress dot and bar. */
export const PROGRESS_DOT_COLORS: Record<"in_progress" | "completed", string> = {
  in_progress: "var(--color-progress-inprogress)",
  completed:   "var(--color-progress-complete)",
};

/** Reading progress of an entry as a 0–100 percent. Capped below 100% until completed. */
export function computeProgress(entry: LibraryEntry, currentPage: number): number {
  if (entry.readingState === "completed") return 100;
  if (!entry.totalPages) return 0;
  return Math.min(
    Math.round((currentPage + 1) / entry.totalPages * 100),
    PROGRESS_INCOMPLETE_CAP,
  );
}
