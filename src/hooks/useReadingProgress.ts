import { useEffect, useState } from "react";
import {
  getReadingProgress,
  savePage,
  saveCascade,
  saveBookmarks,
} from "../utils/readingProgressStore";

export function useReadingProgress(filePath: string, initialPage = 0) {
  const [pageIndex, setPageIndex] = useState(initialPage);
  const [cascadeMode, setCascadeMode] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  // loaded gates UI rendering: while false, callers can hide the page content
  // so the user doesn't see page 1 flash before the saved page is applied.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { page, cascade, bookmarks: savedBookmarks } = await getReadingProgress(filePath);
      if (cancelled) return;

      if (page !== undefined) setPageIndex(page);
      if (cascade !== undefined) setCascadeMode(cascade);
      if (savedBookmarks !== undefined) setBookmarks(savedBookmarks);
      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [filePath]);

  useEffect(() => {
    if (!loaded) return;
    savePage(filePath, pageIndex).catch(console.error);
  }, [pageIndex, filePath, loaded]);

  useEffect(() => {
    if (!loaded) return;
    saveCascade(filePath, cascadeMode).catch(console.error);
  }, [cascadeMode, filePath, loaded]);

  useEffect(() => {
    if (!loaded) return;
    saveBookmarks(filePath, bookmarks).catch(console.error);
  }, [bookmarks, filePath, loaded]);

  return { pageIndex, setPageIndex, cascadeMode, setCascadeMode, bookmarks, setBookmarks, loaded };
}
