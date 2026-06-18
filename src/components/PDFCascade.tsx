import { useEffect, useMemo, useRef, type RefObject } from "react";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// ponytail: render window = pages within one viewport above/below the visible
// area are painted to canvas; the rest stay blank placeholders so memory stays
// bounded (~3 viewports of live canvas). Upgrade path: shrink/grow this margin
// if a very large/very small page size makes the window too heavy or too eager.
const RENDER_ROOT_MARGIN = "100% 0px";
// Thin band across the viewport's vertical center: the page crossing it is the
// "active" page. Robust for pages taller than the viewport (an intersection-ratio
// heuristic would never reach a high ratio for those).
const ACTIVE_PAGE_ROOT_MARGIN = "-50% 0px -49% 0px";

export type PageDim = { width: number; height: number };

function PDFCascade({
  pdf,
  scale,
  pageNum,
  setPageNum,
  pageDims,
  containerRef,
}: {
  pdf: PDFDocumentProxy;
  scale: number;
  pageNum: number;
  setPageNum: (n: number) => void;
  pageDims: PageDim[];
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const placeholderRefs = useRef<(HTMLDivElement | null)[]>([]);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const textLayerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const renderTasks = useRef<Map<number, RenderTask>>(new Map());
  // Last page number the active-page observer reported (from a user scroll). The
  // scroll-to effect compares against it to tell scroll-driven pageNum changes
  // (skip the scroll) from external ones — arrows/Home/End (do scroll). A one-shot
  // flag would get stuck if the observer's last emission didn't change pageNum.
  const lastObservedPageRef = useRef(0);

  // Stable per-index ref setters. Inline `ref={el => ...}` callbacks are recreated
  // every render, so React detaches (null) + reattaches them on each re-render —
  // which would clobber the imperatively-sized canvases on every pageNum change.
  // Memoizing by page count keeps identity stable so React only calls them on
  // mount/unmount.
  const setPlaceholderRef = useMemo(
    () => Array.from({ length: pageDims.length }, (_, i) => (el: HTMLDivElement | null) => { placeholderRefs.current[i] = el; }),
    [pageDims.length]
  );
  const setCanvasRef = useMemo(
    () => Array.from({ length: pageDims.length }, (_, i) => (el: HTMLCanvasElement | null) => { canvasRefs.current[i] = el; }),
    [pageDims.length]
  );
  const setTextLayerRef = useMemo(
    () => Array.from({ length: pageDims.length }, (_, i) => (el: HTMLDivElement | null) => { textLayerRefs.current[i] = el; }),
    [pageDims.length]
  );

  // Render-on-demand + active-page tracking. Re-runs on scale change so visible
  // pages repaint at the new size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let active = true;
    const tasks = renderTasks.current;
    // Pages currently inside the render window. A render that finishes after its
    // page scrolled out (no longer here) is discarded instead of painted.
    const visible = new Set<number>();
    // Per-page text-layer generation. A page re-entering the window starts a new
    // render that bumps its generation; an older in-flight text render then sees
    // the mismatch and bails instead of appending duplicate spans.
    const textGen = new Map<number, number>();

    const renderPage = async (i: number) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;
      // Cancel any in-flight render for this page before starting a new one.
      tasks.get(i)?.cancel();

      const page = await pdf.getPage(i + 1);
      if (!active || !visible.has(i)) return;

      const viewport = page.getViewport({ scale });
      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);

      // Render to a throwaway offscreen canvas, never directly to the visible one.
      // pdfjs forbids two render() calls on the same canvas; using a fresh canvas
      // each time sidesteps that, and the visible canvas keeps its old content
      // until we swap atomically (no blank/black flash mid-render).
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext("2d");
      if (!offCtx) return;

      const task = page.render({ canvasContext: offCtx, viewport, canvas: offscreen });
      tasks.set(i, task);
      try {
        await task.promise;
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === "RenderingCancelledException") return;
        throw e;
      } finally {
        if (tasks.get(i) === task) tasks.delete(i);
      }
      if (!active || !visible.has(i)) return;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.getContext("2d")?.drawImage(offscreen, 0, 0);

      // Overlay the selectable text layer (same viewport as the canvas).
      const textLayerDiv = textLayerRefs.current[i];
      if (!textLayerDiv) return;
      const gen = (textGen.get(i) ?? 0) + 1;
      textGen.set(i, gen);
      const textContent = await page.getTextContent();
      if (!active || !visible.has(i) || textGen.get(i) !== gen) return;
      textLayerDiv.innerHTML = "";
      const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
      await textLayer.render();
      if (textGen.get(i) !== gen) return; // superseded by a newer render — it owns the div
      if (!active || !visible.has(i)) {
        // Page scrolled out while the text layer was rendering — drop the spans.
        textLayerDiv.innerHTML = "";
        return;
      }
      // pdfjs v5 sizes the container via CSS var expressions that may not resolve;
      // set explicit px so the percentage-based span positions land on the bitmap.
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      // pdfjs derives every span's font-size from calc(var(--total-scale-factor) * …).
      // Our custom .textLayer CSS doesn't define it (the official viewer does), so
      // without this the spans fall back to the default font size and the selection
      // highlight is misaligned with the glyphs (text still copies correctly).
      textLayerDiv.style.setProperty("--total-scale-factor", `${viewport.scale}`);
    };

    const clearPage = (i: number) => {
      tasks.get(i)?.cancel();
      tasks.delete(i);
      const canvas = canvasRefs.current[i];
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      const textLayerDiv = textLayerRefs.current[i];
      if (textLayerDiv) textLayerDiv.innerHTML = "";
    };

    const renderObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const i = Number((entry.target as HTMLElement).dataset.pageIndex);
          if (entry.isIntersecting) {
            visible.add(i);
            renderPage(i);
          } else {
            visible.delete(i);
            clearPage(i);
          }
        });
      },
      { root: container, rootMargin: RENDER_ROOT_MARGIN }
    );
    placeholderRefs.current.forEach((el) => el && renderObserver.observe(el));

    let activeObserver: IntersectionObserver | null = null;
    (async () => {
      // Defer one frame so the initial scroll-to-saved-page settles before the
      // observer starts reporting (mirrors the image Reader).
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!active) return;
      activeObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const i = Number((entry.target as HTMLElement).dataset.pageIndex);
            lastObservedPageRef.current = i + 1;
            setPageNum(i + 1);
          });
        },
        { root: container, rootMargin: ACTIVE_PAGE_ROOT_MARGIN }
      );
      placeholderRefs.current.forEach((el) => el && activeObserver!.observe(el));
    })();

    return () => {
      active = false;
      renderObserver.disconnect();
      activeObserver?.disconnect();
      tasks.forEach((task) => task.cancel());
      tasks.clear();
    };
  }, [pdf, scale, setPageNum, containerRef]);

  // Scroll to the page when it changes from outside (saved-page restore on mount,
  // arrow/Home/End jumps) — but not when the observer set it from a user scroll.
  useEffect(() => {
    // Scroll-driven change (observer already centered this page) → don't re-scroll.
    if (pageNum === lastObservedPageRef.current) return;
    const container = containerRef.current;
    const target = placeholderRefs.current[pageNum - 1];
    if (container && target) {
      const containerTop = container.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      container.scrollTo({ top: targetTop - containerTop + container.scrollTop, behavior: "instant" });
    }
  }, [pageNum, containerRef]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center gap-4 h-screen bg-[var(--bg-primary)] py-6 overflow-auto"
    >
      {pageDims.map((dim, i) => (
        <div
          key={i}
          data-page-index={i}
          ref={setPlaceholderRef[i]}
          // Floored to match the canvas bitmap (Math.floor of the viewport) so the
          // text layer spans align with the rendered page.
          style={{ width: Math.floor(dim.width * scale), height: Math.floor(dim.height * scale) }}
          className="relative shrink-0 shadow-xl bg-[var(--bg-tab-active)]"
        >
          {/* width/height start at 0 so the default 300×150 canvas doesn't flash;
              renderPage sets the real size imperatively and React won't clobber it
              since these props never change. */}
          <canvas
            ref={setCanvasRef[i]}
            width={0}
            height={0}
            className="block"
          />
          <div ref={setTextLayerRef[i]} className="textLayer" />
        </div>
      ))}
    </div>
  );
}

export default PDFCascade;
