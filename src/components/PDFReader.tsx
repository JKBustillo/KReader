import { useState, useEffect, useCallback, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import PDFWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Store } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFWorkerUrl;

function PDFReader({
  data,
  filePath,
  resetPages,
}: {
  data: Uint8Array;
  filePath: string;
  resetPages: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [showInfo, setShowInfo] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  useEffect(() => {
    (async () => {
      const s = await Store.load(".reading-progress.dat");
      setStore(s);
      const doc = await pdfjsLib.getDocument({ data }).promise;
      setPdf(doc);
      setNumPages(doc.numPages);

      const saved = await s.get<number>(`${filePath}-page`);
      if (saved != null) setPageNum(Math.max(1, Math.min(saved + 1, doc.numPages)));
    })();
  }, [data, filePath]);

  useEffect(() => {
    const win = getCurrentWindow();
    const fileName = filePath.split(/[/\\]/).pop() || "KReader";
    win.setTitle(`${fileName} - KReader`);
  }, [filePath]);

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
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const task = page.render({ canvasContext: ctx, viewport, canvas });
      renderTaskRef.current = task;

      try {
        await task.promise;
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === "RenderingCancelledException") return;
        throw e;
      }

      if (cancelled) return;

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
        case "ArrowDown":
          setPageNum((p) => Math.min(p + 1, numPages));
          break;
        case "ArrowLeft":
        case "ArrowUp":
          setPageNum((p) => Math.max(p - 1, 1));
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
        case "I":
          setShowInfo((v) => !v);
          break;
        case "Escape":
          getCurrentWindow().setTitle("KReader");
          resetPages();
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
    [numPages, resetPages]
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

  if (!pdf) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1a1b1e]">
        <div className="w-10 h-10 border-4 border-gray-200 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center min-h-screen bg-[#1a1b1e] py-6 overflow-auto"
    >
      <div className="relative" style={{ userSelect: "text" }}>
        <canvas ref={canvasRef} className="shadow-xl rounded block" />
        <div ref={textLayerRef} className="textLayer" />
      </div>

      {/* Top-right shortcuts hint */}
      <div className="fixed top-4 right-4 text-sm opacity-30 bg-gray-800/80 px-3 py-2 rounded select-none text-gray-200">
        {showInfo ? (
          <>
            <div className="font-semibold mb-1 text-center tracking-wide">Atajos de teclado</div>
            <table style={{ borderSpacing: "0 2px", borderCollapse: "separate" }}>
              <tbody>
                {[
                  ["← / →", "Página anterior / siguiente"],
                  ["PageUp / PageDown", "Desplazar o cambiar página"],
                  ["Home / End", "Primera / última página"],
                  ["+ / −", "Zoom"],
                  ["I", "Mostrar / ocultar atajos"],
                  ["F", "Pantalla completa"],
                  ["Escape", "Cerrar lector"],
                  ["X", "Cerrar ventana"],
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td className="pr-3 text-right font-mono text-yellow-300 whitespace-nowrap">
                      {key}
                    </td>
                    <td className="text-gray-200 whitespace-nowrap">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <span className="font-mono">I — atajos</span>
        )}
      </div>

      {/* Bottom-right page info */}
      <div className="fixed bottom-4 right-4 text-sm opacity-30 bg-gray-800/80 px-3 py-2 rounded select-none text-gray-200">
        {showInfo && <div>Zoom: {Math.round(scale * 100)}%</div>}
        <div>
          Página {pageNum} / {numPages}
        </div>
      </div>
    </div>
  );
}

export default PDFReader;
