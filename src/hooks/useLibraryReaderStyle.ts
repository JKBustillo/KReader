import { useEffect, useRef, useState } from "react";
import {
  getReaderStyle,
  saveReaderStyle,
  type ImageReaderStyle,
  type PdfReaderStyle,
  type ReaderStyleKind,
} from "../utils/settingsStore";

type StyleOf<K extends ReaderStyleKind> = K extends "image" ? ImageReaderStyle : PdfReaderStyle;

/**
 * Remembers a reader's view style per library: on mount applies the library's
 * last-used style through `apply`, then saves every change to `style`. With no
 * library (file opened from home/recents/the OS) it does nothing.
 *
 * Returns whether the saved style has been applied, so the reader can hold its
 * content back instead of flashing the default layout first.
 */
export function useLibraryReaderStyle<K extends ReaderStyleKind>(
  kind: K,
  libraryId: string | null,
  style: StyleOf<K>,
  apply: (saved: StyleOf<K>) => void,
): boolean {
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const applyRef = useRef(apply);
  useEffect(() => { applyRef.current = apply; }, [apply]);

  useEffect(() => {
    if (!libraryId) return;
    let cancelled = false;
    // Applied in the same tick as setLoadedFor so the save effect below never
    // sees "loaded" with the defaults still in place (it would overwrite the saved style).
    getReaderStyle(kind, libraryId)
      .then((saved) => {
        if (cancelled) return;
        if (saved) applyRef.current(saved as StyleOf<K>);
        setLoadedFor(libraryId);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setLoadedFor(libraryId);
      });
    return () => { cancelled = true; };
  }, [kind, libraryId]);

  const loaded = libraryId === null || loadedFor === libraryId;

  // Serialized so the effect fires on value changes, not on each new object.
  const serialized = JSON.stringify(style);
  useEffect(() => {
    if (!libraryId || loadedFor !== libraryId) return;
    saveReaderStyle(kind, libraryId, JSON.parse(serialized) as StyleOf<K>).catch(console.error);
  }, [kind, libraryId, loadedFor, serialized]);

  return loaded;
}
