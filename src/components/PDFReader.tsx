import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import PDFWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useOverlayAutoHide } from "../hooks/useOverlayAutoHide";
import { usePinPageIndicator } from "../hooks/usePinPageIndicator";
import { getReadingProgress, savePage, saveCascade } from "../utils/readingProgressStore";
import { basename } from "../utils/folderUtils";
import { setWindowTitle } from "../utils/appWindow";
import { isAtBottom, isAtTop, PAGE_SCROLL_FRACTION, WHEEL_THROTTLE_MS } from "../utils/scroll";
import PDFCascade, { type PageDim } from "./PDFCascade";

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFWorkerUrl;

// Zoom clamps for the PDF reader (distinct from the image reader's range).
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;

function PDFReader({
  src,
  filePath,
  onClose,
  onLoadError,
  onLastPage,
  onPagesLoaded,
}: {
  src: string;
  filePath: string;
  onClose: () => void;
  onLoadError?: (path: string) => void;
  onLastPage?: () => void;
  onPagesLoaded?: (total: number) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [showInfo, setShowInfo] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cascadeMode, setCascadeMode] = useState(false);
  // Per-page dimensions (at scale 1) used to size cascade placeholders. Loaded
  // lazily the first time cascade is enabled. null = not yet computed.
  const [pageDims, setPageDims] = useState<PageDim[] | null>(null);
  const { showOverlay, setShowOverlay, scheduleHide, overlayTimerRef } = useOverlayAutoHide(showInfo);
  const [pinPageIndicator, setPinPageIndicator] = usePinPageIndicator();
  // Tracks whether the rendered canvas is taller than the viewport so the
  // container can switch between centering the page and pinning it to the top.
  const [contentTaller, setContentTaller] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const lastPageFiredRef = useRef(false);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Loaded by URL (asset protocol), so pdf.js fetches the pages it needs
        // via range requests instead of holding the whole file in memory.
        const doc = await pdfjsLib.getDocument({ url: src }).promise;
        if (cancelled) return;
        setLoadError(null);
        setPdf(doc);
        setNumPages(doc.numPages);
        onPagesLoaded?.(doc.numPages);

        const { page: savedPage, cascade: savedCascade } = await getReadingProgress(filePath);
        if (cancelled) return;
        if (savedPage != null) setPageNum(Math.max(1, Math.min(savedPage + 1, doc.numPages)));
        if (savedCascade != null) setCascadeMode(savedCascade);
      } catch (err) {
        if (cancelled) return;
        console.error("[PDFReader] load failed:", err);
        setLoadError(err instanceof Error ? err.message : String(err));
        onLoadError?.(filePath);
      }
    })();

    return () => { cancelled = true; };
  }, [src, filePath, onLoadError, onPagesLoaded]);

  useEffect(() => {
    setWindowTitle(basename(filePath));
  }, [filePath]);

  useEffect(() => {
    lastPageFiredRef.current = false;
  }, [filePath]);

  useEffect(() => {
    if (numPages > 0 && pageNum === numPages && !lastPageFiredRef.current) {
      lastPageFiredRef.current = true;
      onLastPage?.();
    }
  }, [pageNum, numPages, onLastPage]);

  useEffect(() => {
    const handleDblClick = async () => {
      const win = getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
    };
    window.addEventListener("dblclick", handleDblClick);
    return () => window.removeEventListener("dblclick", handleDblClick);
  }, []);

  useEffect(() => {
    // Persist the 0-based page index (shared key format with the image reader).
    if (pdf) {
      savePage(filePath, pageNum - 1).catch(console.error);
    }
  }, [pageNum, filePath, pdf]);

  useEffect(() => {
    // Persist the cascade flag (shared key with the image reader).
    if (pdf) {
      saveCascade(filePath, cascadeMode).catch(console.error);
    }
  }, [cascadeMode, filePath, pdf]);

  // Lazily measure every page (metadata-only viewport) the first time cascade is
  // enabled, so its placeholders have stable heights.
  useEffect(() => {
    if (!pdf || !cascadeMode || pageDims) return;
    let cancelled = false;
    (async () => {
      // ponytail: O(n) getPage upfront. getPage only parses the page dict (cheap),
      // but if very large PDFs stall here, make this lazy per render-window.
      const dims = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) =>
          pdf.getPage(i + 1).then((p) => {
            const vp = p.getViewport({ scale: 1 });
            return { width: vp.width, height: vp.height };
          })
        )
      );
      if (!cancelled) setPageDims(dims);
    })();
    return () => { cancelled = true; };
  }, [pdf, cascadeMode, pageDims]);

  // Render page + text layer (single-page path only; cascade renders its own canvases)
  useEffect(() => {
    if (cascadeMode || !pdf || !canvasRef.current || !textLayerRef.current) return;

    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    const ctx = canvas.getContext("2d")!;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    let cancelled = false;

    (async () => {
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);

      // Render to an offscreen canvas first. pdfjs starts every render by
      // fillRect-ing the target with white (the page background), which causes a
      // visible white flash before the page content paints on top — most
      // noticeable on the first visit to a page since pdfjs hasn't cached it yet.
      // Double-buffering means the visible canvas only changes once via
      // drawImage(), atomically, with no intermediate blank state.
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext("2d");
      if (!offCtx) return;

      const task = page.render({ canvasContext: offCtx, viewport, canvas: offscreen });
      renderTaskRef.current = task;

      try {
        await task.promise;
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === "RenderingCancelledException") return;
        throw e;
      }

      if (cancelled) return;

      // Swap into the visible canvas. Reassigning width/height clears it, so only
      // do that when dimensions actually changed.
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(offscreen, 0, 0);
      setContentTaller(h > window.innerHeight);

      textLayerDiv.innerHTML = "";

      const textContent = await page.getTextContent();
      if (cancelled) return;

      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();

      // pdfjs v5 sets container width via CSS var expressions that may not resolve;
      // override with explicit px so percentage-based span positions work correctly.
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      // pdfjs derives every span's font-size from calc(var(--total-scale-factor) * …);
      // our custom .textLayer CSS doesn't define it, so set it here or the spans fall
      // back to the default font size and the selection highlight is misaligned.
      textLayerDiv.style.setProperty("--total-scale-factor", `${viewport.scale}`);
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNum, scale, cascadeMode]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept text selection shortcuts
      if (e.ctrlKey || e.metaKey) return;

      switch (e.key) {
        case "ArrowRight":
          setPageNum((p) => Math.min(p + 1, numPages));
          break;
        case "ArrowLeft":
          setPageNum((p) => Math.max(p - 1, 1));
          break;
        case "ArrowDown":
          containerRef.current?.scrollBy({ top: 60, behavior: "smooth" });
          e.preventDefault();
          break;
        case "ArrowUp":
          containerRef.current?.scrollBy({ top: -60, behavior: "smooth" });
          e.preventDefault();
          break;
        case "PageDown": {
          const c = containerRef.current;
          if (c) {
            if (isAtBottom(c)) setPageNum((p) => Math.min(p + 1, numPages));
            else c.scrollBy({ top: c.clientHeight * PAGE_SCROLL_FRACTION, behavior: "smooth" });
          }
          e.preventDefault();
          break;
        }
        case "PageUp": {
          const c = containerRef.current;
          if (c) {
            if (isAtTop(c)) setPageNum((p) => Math.max(p - 1, 1));
            else c.scrollBy({ top: -c.clientHeight * PAGE_SCROLL_FRACTION, behavior: "smooth" });
          }
          e.preventDefault();
          break;
        }
        case "Home":
          e.preventDefault();
          setPageNum(1);
          break;
        case "End":
          e.preventDefault();
          setPageNum(numPages);
          break;
        case "+":
        case "=":
          setScale((s) => Math.min(+(s + ZOOM_STEP).toFixed(1), ZOOM_MAX));
          break;
        case "-":
          setScale((s) => Math.max(+(s - ZOOM_STEP).toFixed(1), ZOOM_MIN));
          break;
        case "i":
        case "I": {
          const next = !showInfo;
          setShowInfo(next);
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
        case "c":
        case "C":
          setCascadeMode((c) => !c);
          break;
        case "Escape":
          setWindowTitle();
          onClose();
          break;
      }
    },
    [numPages, onClose, showInfo, setShowOverlay, scheduleHide, overlayTimerRef, setPinPageIndicator]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Scroll wheel page navigation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let throttled = false;

    const handleWheel = (e: WheelEvent) => {
      // Cascade scrolls natively; no boundary page-turn.
      if (throttled || cascadeMode) return;

      if (e.deltaY > 0 && isAtBottom(container)) {
        setPageNum((p) => Math.min(p + 1, numPages));
        throttled = true;
        setTimeout(() => (throttled = false), WHEEL_THROTTLE_MS);
      } else if (e.deltaY < 0 && isAtTop(container)) {
        setPageNum((p) => Math.max(p - 1, 1));
        throttled = true;
        setTimeout(() => (throttled = false), WHEEL_THROTTLE_MS);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [numPages, cascadeMode]);

  // Scroll to top on page change (single-page only; cascade owns its scroll)
  useEffect(() => {
    if (cascadeMode) return;
    containerRef.current?.scrollTo({ top: 0 });
  }, [pageNum, cascadeMode]);

  // Keep contentTaller accurate when the user resizes the window without zooming.
  useEffect(() => {
    const update = () => {
      const canvas = canvasRef.current;
      if (canvas) setContentTaller(canvas.height > window.innerHeight);
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] gap-4 px-6 text-center">
        <p>{t("errors.pdfLoad")}</p>
        <p className="text-sm text-[var(--text-secondary)] font-mono break-all">{loadError}</p>
        <button
          onClick={() => { setWindowTitle(); onClose(); }}
          className="px-4 py-2 rounded-lg font-medium transition-all duration-200 hover:shadow-[0_0_20px_var(--glow)]"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          {t("errors.goBack")}
        </button>
      </div>
    );
  }

  if (!pdf) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <div className="w-10 h-10 border-4 border-[var(--border-spinner)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      {cascadeMode ? (
        pageDims ? (
          <PDFCascade
            pdf={pdf}
            scale={scale}
            pageNum={pageNum}
            setPageNum={setPageNum}
            pageDims={pageDims}
            containerRef={containerRef}
          />
        ) : (
          <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
            <div className="w-10 h-10 border-4 border-[var(--border-spinner)] border-t-transparent rounded-full animate-spin" />
          </div>
        )
      ) : (
        <div
          ref={containerRef}
          className={`flex flex-col items-center h-screen bg-[var(--bg-primary)] py-6 overflow-auto ${contentTaller ? 'justify-start' : 'justify-center'}`}
        >
          <div className="relative" style={{ userSelect: "text" }}>
            <canvas ref={canvasRef} className="shadow-xl block" />
            <div ref={textLayerRef} className="textLayer" />
          </div>
        </div>
      )}

      {/* Top-right shortcuts hint */}
      <div
        className="fixed top-4 right-4 text-sm px-3 py-2 rounded select-none"
        style={{
          background: 'var(--bg-overlay)',
          color: 'var(--text-overlay)',
          opacity: (showInfo || showOverlay) ? 0.3 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: (showInfo || showOverlay) ? 'auto' : 'none',
        }}
      >
        {showInfo ? (
          <>
            <div className="font-semibold mb-1 text-center tracking-wide">{t('shortcuts.title')}</div>
            <table style={{ borderSpacing: "0 2px", borderCollapse: "separate" }}>
              <tbody>
                {[
                  ["← / →",          t('shortcuts.prevNext')],
                  ["PageUp / PageDown", t('shortcuts.scrollOrTurn')],
                  ["Home / End",      t('shortcuts.firstLast')],
                  ["C",              t('shortcuts.cascade')],
                  ["+ / −",          t('shortcuts.zoom')],
                  ["I",              t('shortcuts.showHide')],
                  ["F",              t('shortcuts.fullscreen')],
                  ["Escape",         t('shortcuts.closeReader')],
                  ["X",              t('shortcuts.closeWindow')],
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td className="pr-3 text-right font-mono text-[var(--text-key)] whitespace-nowrap">
                      {key}
                    </td>
                    <td className="text-[var(--text-overlay)] whitespace-nowrap">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <span className="font-mono">{t('shortcuts.hint')}</span>
        )}
      </div>

      {/* Bottom-right page info */}
      <div
        className="fixed bottom-4 right-4 text-sm px-3 py-2 rounded select-none"
        style={{
          background: 'var(--bg-overlay)',
          color: 'var(--text-overlay)',
          opacity: (showInfo || showOverlay || pinPageIndicator) ? 0.3 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: (showInfo || showOverlay || pinPageIndicator) ? 'auto' : 'none',
        }}
      >
        {showInfo && <div>{t('reader.zoom')}: {Math.round(scale * 100)}%</div>}
        <div>
          {showInfo && `${t('reader.page')} `}
          {pageNum} {t('reader.of')} {numPages}
        </div>
      </div>
    </>
  );
}

export default PDFReader;
