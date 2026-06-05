import type { LibraryEntry } from "../types/library";
import { setLastOpenedAt, setReadingState, setTotalPages } from "./libraryStore";

const MILLIS_PER_SECOND = 1000;

/**
 * Begins library reading bookkeeping for an entry opened outside LibraryView
 * (e.g. a sibling reached via Ctrl+Arrow, while LibraryView is unmounted).
 *
 * Mirrors the persistence side of `LibraryView.handleOpen` but writes straight
 * to `.library.dat` via libraryStore — no React state, since the library UI is
 * not mounted during reading and rescans on return. Marks the entry opened
 * (lastOpenedAt + in_progress unless already completed) and returns the
 * completion / page-count callbacks the reader fires on its last page / load.
 */
export function startLibraryReadingSession(entry: LibraryEntry): {
  onComplete?: () => void;
  onPagesLoaded: (total: number) => void;
} {
  const now = Math.floor(Date.now() / MILLIS_PER_SECOND);
  setLastOpenedAt(entry.id, entry.libraryId, now).catch(console.error);

  const alreadyCompleted = entry.readingState === "completed";
  if (!alreadyCompleted) {
    setReadingState(entry.id, entry.libraryId, "in_progress").catch(console.error);
  }

  const onComplete = alreadyCompleted
    ? undefined
    : () => {
        setReadingState(entry.id, entry.libraryId, "completed").catch(console.error);
      };

  const onPagesLoaded = (total: number) => {
    setTotalPages(entry.id, entry.libraryId, total).catch(console.error);
  };

  return { onComplete, onPagesLoaded };
}
