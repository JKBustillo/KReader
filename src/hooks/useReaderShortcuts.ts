import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { readDir } from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";

import { IMAGE_EXTS_SET, extOf } from "../loaders";
import { basename } from "../utils/folderUtils";
import { setWindowTitle } from "../utils/appWindow";
import { isAtBottom, isAtTop, PAGE_SCROLL_FRACTION } from "../utils/scroll";

// Zoom clamps for the image reader (distinct from the PDF reader's range).
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

type Params = {
  containerRef: RefObject<HTMLDivElement | null>;
  overlayTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  filePath: string;
  pagesLength: number;
  pageIndex: number;
  cascadeMode: boolean;
  rtl: boolean;
  showMoreInfo: boolean;
  smoothScroll: ScrollBehavior;
  bookmarks: number[];
  nextPage: () => void;
  prevPage: () => void;
  onClose: () => void;
  setPageIndex: Dispatch<SetStateAction<number>>;
  webtoonMode: boolean;
  setWebtoonMode: Dispatch<SetStateAction<boolean>>;
  setCascadeMode: Dispatch<SetStateAction<boolean>>;
  setDoublePage: Dispatch<SetStateAction<boolean>>;
  setRtl: Dispatch<SetStateAction<boolean>>;
  setShowGap: Dispatch<SetStateAction<boolean>>;
  setSmoothScroll: Dispatch<SetStateAction<ScrollBehavior>>;
  setZoom: Dispatch<SetStateAction<number>>;
  setShowMoreInfo: Dispatch<SetStateAction<boolean>>;
  setShowOverlay: Dispatch<SetStateAction<boolean>>;
  setPinPageIndicator: Dispatch<SetStateAction<boolean>>;
  setBookmarks: Dispatch<SetStateAction<number[]>>;
  checkHeight: (zoom: number) => void;
  scheduleHide: () => void;
};

export function useReaderShortcuts(params: Params) {
  const {
    containerRef,
    overlayTimerRef,
    filePath,
    pagesLength,
    pageIndex,
    cascadeMode,
    rtl,
    showMoreInfo,
    smoothScroll,
    bookmarks,
    nextPage,
    prevPage,
    onClose,
    setPageIndex,
    setWebtoonMode,
    setCascadeMode,
    setDoublePage,
    setRtl,
    setShowGap,
    setSmoothScroll,
    setZoom,
    setShowMoreInfo,
    setShowOverlay,
    setPinPageIndicator,
    setBookmarks,
    checkHeight,
    scheduleHide,
  } = params;

  const handleKeyDown = useCallback(
    async (e: KeyboardEvent) => {
      const container = containerRef.current;
      const key = e.key;

      if (e.ctrlKey && (key === "ArrowRight" || key === "ArrowLeft")) {
        e.preventDefault();
        const currentExt = extOf(filePath);

        // Standalone image: the whole folder is already loaded as pages — navigate normally.
        if (IMAGE_EXTS_SET.has(currentExt)) {
          if (!cascadeMode) {
            if (key === "ArrowRight") { if (rtl) prevPage(); else nextPage(); }
            else { if (rtl) nextPage(); else prevPage(); }
          }
          return;
        }

        try {
          const dir = await dirname(filePath);
          const files = await readDir(dir);

          const siblings = files
            .filter((f) => f.name?.toLowerCase().endsWith(`.${currentExt}`))
            .sort((a, b) => a.name!.localeCompare(b.name!, undefined, { numeric: true }));
          const siblingPaths = await Promise.all(siblings.map((f) => join(dir, f.name!)));

          const currentName = basename(filePath);
          const currentIndex = siblingPaths.findIndex((p) => p.endsWith(currentName));

          let newIndex = currentIndex;
          if (key === "ArrowRight" && currentIndex < siblings.length - 1) newIndex++;
          else if (key === "ArrowLeft" && currentIndex > 0) newIndex--;

          if (newIndex !== currentIndex) {
            window.dispatchEvent(new CustomEvent("openNewCbz", { detail: siblingPaths[newIndex] }));
          }
        } catch (err) {
          console.error("Error switching file:", err);
        }
        return;
      }

      switch (key) {
        case "c":
        case "C":
          setCascadeMode((c) => {
            if (!c) setWebtoonMode(false);
            return !c;
          });
          break;
        case "w":
        case "W":
          setWebtoonMode((w) => {
            if (!w) setCascadeMode(false);
            return !w;
          });
          break;
        case "+":
        case "=":
          setZoom((z) => {
            const newZoom = Math.min(z + ZOOM_STEP, ZOOM_MAX);
            checkHeight(newZoom);
            return newZoom;
          });
          break;
        case "-":
          setZoom((z) => {
            const newZoom = Math.max(z - ZOOM_STEP, ZOOM_MIN);
            checkHeight(newZoom);
            return newZoom;
          });
          break;
        case "ArrowRight":
          if (!cascadeMode) { if (rtl) prevPage(); else nextPage(); }
          break;
        case "ArrowLeft":
          if (!cascadeMode) { if (rtl) nextPage(); else prevPage(); }
          break;
        case "PageDown": {
          if (!cascadeMode) e.preventDefault();
          if (container) {
            const scrollDown = () =>
              container.scrollBy({ top: container.clientHeight * PAGE_SCROLL_FRACTION, behavior: "smooth" });
            if (isAtBottom(container)) {
              if (cascadeMode) scrollDown(); else nextPage();
            } else {
              scrollDown();
            }
          }
          break;
        }
        case "PageUp": {
          if (container) {
            const scrollUp = () =>
              container.scrollBy({ top: -container.clientHeight * PAGE_SCROLL_FRACTION, behavior: "smooth" });
            if (isAtTop(container)) {
              if (cascadeMode) scrollUp(); else prevPage();
            } else {
              scrollUp();
            }
          }
          break;
        }
        case "Escape":
          setWindowTitle();
          onClose();
          break;
        case "d":
        case "D":
          setDoublePage((d) => !d);
          break;
        case "i":
        case "I": {
          const next = !showMoreInfo;
          setShowMoreInfo(next);
          if (!next) {
            setShowOverlay(true);
            scheduleHide();
          } else if (overlayTimerRef.current) {
            clearTimeout(overlayTimerRef.current);
          }
          break;
        }
        case "p":
        case "P":
          setPinPageIndicator((p) => !p);
          break;
        case "s":
        case "S":
          setRtl((r) => !r);
          break;
        case "g":
        case "G":
          setShowGap((g) => !g);
          break;
        case "j":
        case "J":
          setSmoothScroll(smoothScroll === "smooth" ? "instant" : "smooth");
          break;
        case "Home":
          if (!cascadeMode) {
            e.preventDefault();
            setPageIndex(0);
          }
          break;
        case "End":
          if (!cascadeMode) {
            e.preventDefault();
            setPageIndex(pagesLength - 1);
          }
          break;
        case "b":
        case "B":
          setBookmarks((bm) =>
            bm.includes(pageIndex)
              ? bm.filter((p) => p !== pageIndex)
              : [...bm, pageIndex].sort((a, b) => a - b)
          );
          break;
        case "[": {
          const prev = [...bookmarks].reverse().find((p) => p < pageIndex);
          if (prev !== undefined) setPageIndex(prev);
          break;
        }
        case "]": {
          const next = bookmarks.find((p) => p > pageIndex);
          if (next !== undefined) setPageIndex(next);
          break;
        }
        default:
          break;
      }
    },
    [
      containerRef, overlayTimerRef, filePath, pagesLength,
      pageIndex, cascadeMode, rtl, showMoreInfo, smoothScroll,
      bookmarks,
      nextPage, prevPage, onClose,
      setPageIndex, setWebtoonMode, setCascadeMode, setDoublePage, setRtl, setShowGap, setSmoothScroll,
      setZoom, setShowMoreInfo, setShowOverlay, setPinPageIndicator, setBookmarks,
      checkHeight, scheduleHide,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
