import { useState, useEffect, useCallback, useRef } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { readDir } from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";

function Reader({
  pages,
  resetPages,
  filePath,
}: {
  pages: string[];
  resetPages: () => void;
  filePath: string;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [doublePage, setDoublePage] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [showGap, setShowGap] = useState(true);
  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [smoothScroll, setSmoothScroll] = useState<ScrollBehavior>('smooth');
  const [store, setStore] = useState<Store | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const s = await Store.load(".reading-progress.dat");
      setStore(s);
      const savedPage = await s.get<number>(`${filePath}-page`);
      if (savedPage !== undefined) setPageIndex(savedPage);
    })();
  }, [filePath]);

  useEffect(() => {
    const updateTitle = async () => {
      const win = getCurrentWindow();
      const fileName = filePath.split(/[/\\]/).pop() || "KReader1";
      await win.setTitle(`${fileName} - KReader`);
    };

    updateTitle();
  }, [filePath]);

  useEffect(() => {
    if (store) {
      store.set(`${filePath}-page`, pageIndex);
      store.save();
    }
  }, [pageIndex, store, filePath]);

  const currentPages = doublePage
    ? pages.slice(pageIndex, pageIndex + 2)
    : [pages[pageIndex]];

  const nextPage = useCallback(() => {
    setPageIndex((prev) =>
      Math.min(prev + (doublePage ? 2 : 1), pages.length - 1)
    );
  }, [pages.length, doublePage]);

  const prevPage = useCallback(() => {
    setPageIndex((prev) => Math.max(prev - (doublePage ? 2 : 1), 0));
  }, [doublePage]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: smoothScroll });
    }
  }, [pageIndex]);

  const handleKeyDown = useCallback(
    async (e: KeyboardEvent) => {
      const container = containerRef.current;
      const key = e.key;

      if (e.ctrlKey && (key === "ArrowRight" || key === "ArrowLeft")) {
        e.preventDefault();
        try {
          const dir = await dirname(filePath);
          const files = await readDir(dir);


          const cbzFiles = files.filter(e => e.name?.toLowerCase().endsWith(".cbz"));
          const cbzList = await Promise.all(cbzFiles.map(e => join(dir, e.name!)));

          const currentIndex = cbzList.findIndex(
            (p) => p.endsWith(filePath.split(/[/\\]/).pop()!)
          );

          let newIndex = currentIndex;
          if (key === "ArrowRight" && currentIndex < cbzFiles.length - 1)
            newIndex++;
          else if (key === "ArrowLeft" && currentIndex > 0)
            newIndex--;

          if (newIndex !== currentIndex) {
            const newPath = cbzFiles[newIndex];
            resetPages(); // Limpia páginas actuales
            window.dispatchEvent(
              new CustomEvent("openNewCbz", { detail: `${dir}\\${newPath.name}` })
            ); // ⬅️ Emite evento global
          }
        } catch (err) {
          console.error("Error al cambiar de cómic:", err);
        }
        return;
      }

      switch (key) {
        case "+":
        case "=":
          setZoom((z) => Math.min(z + 0.1, 3));
          break;
        case "-":
          setZoom((z) => Math.max(z - 0.1, 0.5));
          break;
        case "ArrowRight":
          rtl ? prevPage() : nextPage();
          break;
        case "ArrowLeft":
          rtl ? nextPage() : prevPage();
          break;
        case "PageDown":
          e.preventDefault();
          if (container) {
            const atBottom =
              container.scrollTop + container.clientHeight >=
              container.scrollHeight - 10;
            if (atBottom) {
              nextPage();
            } else {
              container.scrollBy({
                top: container.clientHeight * 0.9,
                behavior: "smooth",
              });
            }
          }
          break;

        case "PageUp":
          if (container) {
            const atTop = container.scrollTop <= 10;
            if (atTop) {
              prevPage();
            } else {
              container.scrollBy({
                top: -container.clientHeight * 0.9,
                behavior: "smooth",
              });
            }
          }
          break;
        case "Escape":
          const win = getCurrentWindow();
          win.setTitle(`KReader`);
          resetPages();
          break;
        case "d":
        case "D":
          setDoublePage((d) => !d);
          break;
        case "i":
        case "I":
          setShowMoreInfo((d) => !d);
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
          setSmoothScroll(smoothScroll === 'smooth' ? 'instant' : 'smooth');
          break;
        case "Home":
          e.preventDefault();
          setPageIndex(0);
          break;
        case "End":
          e.preventDefault();
          setPageIndex(pages.length - 1);
          break;

        default:
          break;
      }
    },
    [nextPage, prevPage, resetPages, rtl, smoothScroll]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isThrottled = false;

    const handleWheel = (e: WheelEvent) => {
      if (!container || isThrottled) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10;
      const atTop = scrollTop <= 10;

      if (e.deltaY > 0) {
        if (atBottom) {
          nextPage();
          isThrottled = true;
          setTimeout(() => (isThrottled = false), 700);
        } else {
          container.scrollBy({
            top: e.deltaY,
            behavior: "smooth",
          });
        }
      } else if (e.deltaY < 0) {
        if (atTop) {
          prevPage();
          isThrottled = true;
          setTimeout(() => (isThrottled = false), 700);
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
  }, [nextPage, prevPage]);


  return (
    <div
      ref={containerRef}
      className="flex justify-center items-center bg-gray-900 text-white min-h-screen overflow-auto"
      style={{ scrollBehavior: "smooth" }}
    >
      <div
        className={`flex ${doublePage
          ? rtl
            ? "flex-row-reverse"
            : "flex-row"
          : "flex-col"
          } justify-center items-center`}
        style={{
          gap: showGap && doublePage ? "1rem" : "0",
          transform: `scale(${zoom})`,
          transformOrigin: "center top",
          transition: "transform 0.2s ease-in-out",
        }}
      >
        {currentPages.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`Page ${pageIndex + i + 1}`}
            className={`${doublePage ? "max-w-[45vw]" : "max-w-[80vw]"
              } max-h-[90vh] object-contain rounded shadow-md`}
          />
        ))}
      </div>

      <div className="fixed bottom-4 right-4 text-sm opacity-30 bg-gray-800/80 px-3 py-2 rounded">
        {showMoreInfo && <>
          <div>{doublePage ? "📖 Doble página" : "📄 Una página"}</div>
          <div>Orientación: {rtl ? "⇠ Derecha → Izquierda" : "⇢ Izquierda → Derecha"}</div>
          <div>{showGap ? "Con separación" : "Sin separación"}</div>
        </>}
        <div>Página {pageIndex + 1} / {pages.length}</div>
      </div>
    </div>
  );
}

export default Reader;
