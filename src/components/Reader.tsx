import { useState, useEffect, useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useReadingProgress } from "../hooks/useReadingProgress";
import { useReaderShortcuts } from "../hooks/useReaderShortcuts";
import { useOverlayAutoHide } from "../hooks/useOverlayAutoHide";
import { usePinPageIndicator } from "../hooks/usePinPageIndicator";
import { basename } from "../utils/folderUtils";
import { setWindowTitle } from "../utils/appWindow";
import { isAtBottom, isAtTop, WHEEL_THROTTLE_MS } from "../utils/scroll";
import ReaderOverlay from "./ReaderOverlay";

// How many screens' worth of pages to fetch on each side of the current one.
// Pages are URLs the webview caches (see PAGE_CACHE_CONTROL in lib.rs), so
// preloading both directions makes a page turn either way hit the cache.
const PRELOAD_SCREENS = 2;

function Reader({
  pages,
  onClose,
  filePath,
  startPage = 0,
  pageNames,
  onLastPage,
}: {
  pages: string[];
  onClose: () => void;
  filePath: string;
  startPage?: number;
  pageNames?: string[];
  onLastPage?: () => void;
}) {
  const { pageIndex, setPageIndex, cascadeMode, setCascadeMode, bookmarks, setBookmarks, loaded } = useReadingProgress(filePath, startPage);
  const lastPageFiredRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [webtoonMode, setWebtoonMode] = useState(false);
  const [doublePage, setDoublePage] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [showGap, setShowGap] = useState(true);
  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [smoothScroll, setSmoothScroll] = useState<ScrollBehavior>('instant');
  const [isTallerThanViewport, setIsTallerThanViewport] = useState(false);

  const { showOverlay, setShowOverlay, scheduleHide, overlayTimerRef } = useOverlayAutoHide(showMoreInfo);
  const [pinPageIndicator, setPinPageIndicator] = usePinPageIndicator();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Lets the scroll-to effect know that a pageIndex update came from the cascade
  // IntersectionObserver (user scroll) and shouldn't trigger another scroll.
  const pageIndexSourceRef = useRef<'external' | 'observer'>('external');

  useEffect(() => {
    lastPageFiredRef.current = false;
  }, [filePath]);

  useEffect(() => {
    if (pages.length > 0 && pageIndex === pages.length - 1 && !lastPageFiredRef.current) {
      lastPageFiredRef.current = true;
      onLastPage?.();
    }
  }, [pageIndex, pages.length, onLastPage]);

  useEffect(() => {
    setWindowTitle(pageNames?.[pageIndex] ?? basename(filePath));
  }, [filePath, pageIndex, pageNames]);

  useEffect(() => {
    const handleDblClick = async () => {
      const win = getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
    };
    window.addEventListener("dblclick", handleDblClick);
    return () => window.removeEventListener("dblclick", handleDblClick);
  }, []);

  const currentPages = cascadeMode || webtoonMode
    ? pages
    : doublePage
      ? pages.slice(pageIndex, pageIndex + 2)
      : [pages[pageIndex]];

  const nextPage = useCallback(() => {
    setPageIndex((prev) =>
      Math.min(prev + (doublePage ? 2 : 1), pages.length - 1)
    );
  }, [pages.length, doublePage, setPageIndex]);

  const prevPage = useCallback(() => {
    setPageIndex((prev) => Math.max(prev - (doublePage ? 2 : 1), 0));
  }, [doublePage, setPageIndex]);

  useEffect(() => {
    if (pageIndexSourceRef.current === 'observer') {
      pageIndexSourceRef.current = 'external';
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const images = Array.from(container.querySelectorAll("img"));
      const unloaded = images.filter(img => !img.complete);
      if (unloaded.length > 0) {
        await Promise.all(unloaded.map(img => new Promise<void>(resolve => { img.onload = img.onerror = () => resolve(); })));
      }
      if (cascadeMode || webtoonMode) {
        const target = images[pageIndex];
        if (target) {
          // getBoundingClientRect returns the *visual* (transformed) bounds, so this
          // accounts for the scale applied to the inner content. Using offsetTop here
          // would drift by a factor of zoom (page 14 lands on ~page 10 at zoom 1.4).
          // Instant scroll prevents the cascade observer (which mounts on next frame)
          // from snapping to whatever page is mid-animation.
          const containerTop = container.getBoundingClientRect().top;
          const targetTop = target.getBoundingClientRect().top;
          container.scrollTo({ top: targetTop - containerTop + container.scrollTop, behavior: 'instant' });
        }
      } else {
        container.scrollTo({ top: 0, behavior: smoothScroll });
      }
    })();
  }, [pageIndex, cascadeMode, webtoonMode, smoothScroll]);

  // Cascade mode: track which image is most visible and reflect it in pageIndex.
  useEffect(() => {
    if (!cascadeMode && !webtoonMode) return;
    const container = containerRef.current;
    if (!container) return;

    let active = true;
    let observer: IntersectionObserver | null = null;

    (async () => {
      const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
      const unloaded = imgs.filter(img => !img.complete);
      if (unloaded.length > 0) {
        // addEventListener instead of img.onload= so we don't clobber the scroll-to
        // effect's handler — both effects wait for the same images and if one
        // overwrites the other's onload, the scroll-to promise never resolves.
        await Promise.all(unloaded.map(img => new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })));
      }
      if (!active) return;

      // Wait one frame so the cascade-entry scrollTo has settled before the
      // observer's first emission overrides the restored pageIndex.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!active) return;

      observer = new IntersectionObserver(
        (entries) => {
          let bestIdx = -1;
          let bestRatio = 0;
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
              bestRatio = entry.intersectionRatio;
              bestIdx = imgs.indexOf(entry.target as HTMLImageElement);
            }
          });
          if (bestIdx >= 0) {
            pageIndexSourceRef.current = 'observer';
            setPageIndex(bestIdx);
          }
        },
        { root: container, threshold: [0.25, 0.5, 0.75] }
      );
      imgs.forEach((img) => observer!.observe(img));
    })();

    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [cascadeMode, webtoonMode, pages, setPageIndex]);

  useEffect(() => {
    if (cascadeMode || webtoonMode) return;

    // Pages on screen are [pageIndex, pageIndex + screen - 1]; fetch outwards
    // from both edges of that range.
    const screen = doublePage ? 2 : 1;
    for (let offset = 1; offset <= PRELOAD_SCREENS * screen; offset++) {
      for (const index of [pageIndex + screen - 1 + offset, pageIndex - offset]) {
        const src = pages[index];
        if (src) new Image().src = src;
      }
    }
  }, [pageIndex, pages, doublePage, cascadeMode, webtoonMode]);

  const checkHeight = useCallback((zoom: number) => {
    if (contentRef.current) {
      const contentHeight = contentRef.current.offsetHeight * zoom;
      setIsTallerThanViewport(contentHeight > window.innerHeight);
    }
  }, []);

  // Recompute whether the (zoomed) page exceeds the viewport on every page or zoom
  // change, waiting for the image to load (offsetHeight is unreliable before then).
  // Without this the flag stays set for the previous, taller page, so navigating to
  // a shorter page keeps it glued to the top (items-start) instead of centering.
  useEffect(() => {
    if (cascadeMode || webtoonMode) return;
    const img = contentRef.current?.querySelector("img");
    if (!img) return;
    if (img.complete) {
      checkHeight(zoom);
      return;
    }
    const onLoad = () => checkHeight(zoom);
    img.addEventListener("load", onLoad, { once: true });
    return () => img.removeEventListener("load", onLoad);
  }, [pageIndex, zoom, pages, doublePage, cascadeMode, webtoonMode, checkHeight]);

  useReaderShortcuts({
    containerRef,
    overlayTimerRef,
    filePath,
    pagesLength: pages.length,
    pageIndex,
    cascadeMode,
    webtoonMode,
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
    scheduleHide,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isThrottled = false;

    const handleWheel = (e: WheelEvent) => {
      if (!container || isThrottled || cascadeMode || webtoonMode) return;

      if (e.deltaY > 0) {
        if (isAtBottom(container)) {
          nextPage();
          isThrottled = true;
          setTimeout(() => (isThrottled = false), WHEEL_THROTTLE_MS);
        } else {
          container.scrollBy({
            top: e.deltaY,
            behavior: "smooth",
          });
        }
      } else if (e.deltaY < 0) {
        if (isAtTop(container)) {
          prevPage();
          isThrottled = true;
          setTimeout(() => (isThrottled = false), WHEEL_THROTTLE_MS);
        } else {
          container.scrollBy({
            top: e.deltaY,
            behavior: "smooth",
          });
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: true });

    return () => container.removeEventListener("wheel", handleWheel);
  }, [nextPage, prevPage, cascadeMode, webtoonMode]);

  const flexDirection = cascadeMode || webtoonMode
    ? "flex-col"
    : doublePage
      ? rtl ? "flex-row-reverse" : "flex-row"
      : "flex-col";

  return (
    <div
      ref={containerRef}
      className={`flex justify-center ${isTallerThanViewport || cascadeMode || webtoonMode ? "items-start" : "items-center"} bg-[var(--reader-bg)] text-[var(--text-primary)] h-screen overflow-auto`}
      style={{ scrollBehavior: "smooth" }}
    >
      {loaded && (
        <div
          ref={contentRef}
          className={`flex ${flexDirection} justify-center items-center`}
          style={{
            gap: webtoonMode ? "0" : showGap ? "1rem" : "0",
            transform: `scale(${zoom})`,
            transformOrigin: isTallerThanViewport || cascadeMode || webtoonMode ? "center top" : "center",
            transition: cascadeMode || webtoonMode ? "none" : "transform 0.2s ease-in-out",
          }}
        >
          {currentPages.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Page ${i + 1}`}
              className={
                webtoonMode
                  ? "w-auto max-w-[90vw] object-contain"
                  : cascadeMode
                    ? "w-auto max-w-[95vw] max-h-[95vh] object-contain shadow-md"
                    : "max-h-screen object-contain shadow-md"
              }
              style={webtoonMode || cascadeMode ? undefined : { maxWidth: `${doublePage ? 45 : 80}vw` }}
            />
          ))}
        </div>
      )}

      <ReaderOverlay
        showMoreInfo={showMoreInfo}
        showOverlay={showOverlay}
        pinPageIndicator={pinPageIndicator}
        cascadeMode={cascadeMode}
        webtoonMode={webtoonMode}
        doublePage={doublePage}
        rtl={rtl}
        showGap={showGap}
        zoom={zoom}
        pageIndex={pageIndex}
        pagesLength={pages.length}
        bookmarks={bookmarks}
      />
    </div>
  );
}

export default Reader;
