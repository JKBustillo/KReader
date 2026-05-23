import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import PDFWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Store } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useOverlayAutoHide } from "../hooks/useOverlayAutoHide";
import { usePinPageIndicator } from "../hooks/usePinPageIndicator";

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFWorkerUrl;

function PDFReader({
  data,
  filePath,
  onClose,
  onLoadError,
  onLastPage,
}: {
  data: Uint8Array;
  filePath: string;
  onClose: () => void;
  onLoadError?: (path: string) => void;
  onLastPage?: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [showInfo, setShowInfo] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        const s = await Store.load(".reading-progress.dat");
        if (cancelled) return;
        setStore(s);

        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        setLoadError(null);
        setPdf(doc);
        setNumPages(doc.numPages);

        const saved = await s.get<number>(`${filePath}-page`);
        if (cancelled) return;
        if (saved != null) setPageNum(Math.max(1, Math.min(saved + 1, doc.numPages)));
      } catch (err) {
        if (cancelled) return;
        console.error("[PDFReader] load failed:", err);
        setLoadError(err instanceof Error ? err.message : String(err));
        onLoadError?.(filePath);
      }
    })();

    return () => { cancelled = true; };
  }, [data, filePath, onLoadError]);

  useEffect(() => {
    const win = getCurrentWindow();
    const fileName = filePath.split(/[/\\]/).pop() || "KReader";
    win.setTitle(`${fileName} - KReader`);
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
    if (store && pdf) {
      store.set(`${filePath}-page`, pageNum - 1);
      store.save();
    }
  }, [pageNum, store, filePath, pdf]);

  // Render page + text layer
  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerRef.current) return;

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
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNum, scale]);

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
            const atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 10;
            if (atBottom) setPageNum((p) => Math.min(p + 1, numPages));
            else c.scrollBy({ top: c.clientHeight * 0.9, behavior: "smooth" });
          }
          e.preventDefault();
          break;
        }
        case "PageUp": {
          const c = containerRef.current;
          if (c) {
            const atTop = c.scrollTop <= 10;
            if (atTop) setPageNum((p) => Math.max(p - 1, 1));
            else c.scrollBy({ top: -c.clientHeight * 0.9, behavior: "smooth" });
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
          setScale((s) => Math.min(+(s + 0.1).toFixed(1), 4));
          break;
        case "-":
          setScale((s) => Math.max(+(s - 0.1).toFixed(1), 0.3));
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
        case "Escape":
          getCurrentWindow().setTitle("KReader");
          onClose();
          break;
        case "f":
        case "F":
          getCurrentWindow()
            .isFullscreen()
            .then((full) => getCurrentWindow().setFullscreen(!full));
          break;
        case "x":
        case "X":
          getCurrentWindow().close();
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
      if (throttled) return;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 10;
      const atTop = container.scrollTop <= 10;

      if (e.deltaY > 0 && atBottom) {
        setPageNum((p) => Math.min(p + 1, numPages));
        throttled = true;
        setTimeout(() => (throttled = false), 700);
      } else if (e.deltaY < 0 && atTop) {
        setPageNum((p) => Math.max(p - 1, 1));
        throttled = true;
        setTimeout(() => (throttled = false), 700);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [numPages]);

  // Scroll to top on page change
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [pageNum]);

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
          onClick={() => { getCurrentWindow().setTitle("KReader"); onClose(); }}
          className="px-4 py-2 rounded bg-blue-500 hover:bg-blue-600 text-white"
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
    <div
      ref={containerRef}
      className={`flex flex-col items-center h-screen bg-[var(--bg-primary)] py-6 overflow-auto ${contentTaller ? 'justify-start' : 'justify-center'}`}
    >
      <div className="relative" style={{ userSelect: "text" }}>
        <canvas ref={canvasRef} className="shadow-xl block" />
        <div ref={textLayerRef} className="textLayer" />
      </div>

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
    </div>
  );
}

export default PDFReader;
