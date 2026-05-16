import { useEffect, useRef, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = ".reading-progress.dat";

export function useReadingProgress(filePath: string, initialPage = 0) {
  const [pageIndex, setPageIndex] = useState(initialPage);
  const [cascadeMode, setCascadeMode] = useState(false);
  // loaded gates UI rendering: while false, callers can hide the page content
  // so the user doesn't see page 1 flash before the saved page is applied.
  const [loaded, setLoaded] = useState(false);
  const storeRef = useRef<Store | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const s = await Store.load(STORE_FILE);
      if (cancelled) return;
      storeRef.current = s;

      const savedPage = await s.get<number>(`${filePath}-page`);
      const savedCascade = await s.get<boolean>(`${filePath}-cascade`);
      if (cancelled) return;

      if (savedPage !== undefined) setPageIndex(savedPage);
      if (savedCascade !== undefined) setCascadeMode(savedCascade);
      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [filePath]);

  useEffect(() => {
    if (!loaded) return;
    const s = storeRef.current;
    if (!s) return;
    s.set(`${filePath}-page`, pageIndex);
    s.save();
  }, [pageIndex, filePath, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const s = storeRef.current;
    if (!s) return;
    s.set(`${filePath}-cascade`, cascadeMode);
    s.save();
  }, [cascadeMode, filePath, loaded]);

  return { pageIndex, setPageIndex, cascadeMode, setCascadeMode, loaded };
}
