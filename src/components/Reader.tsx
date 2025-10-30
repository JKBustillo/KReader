import { useState, useEffect, useCallback } from "react";

function Reader({ pages, resetPages }: { pages: string[], resetPages: () => void }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [doublePage, setDoublePage] = useState(false);

  // 🔹 Determinar cuántas páginas mostrar según el modo
  const currentPages = doublePage
    ? pages.slice(pageIndex, pageIndex + 2)
    : [pages[pageIndex]];

  // 🔹 Navegación
  const nextPage = useCallback(() => {
    setPageIndex((prev) =>
      Math.min(prev + (doublePage ? 2 : 1), pages.length - 1)
    );
  }, [pages.length, doublePage]);

  const prevPage = useCallback(() => {
    setPageIndex((prev) => Math.max(prev - (doublePage ? 2 : 1), 0));
  }, [doublePage]);

  // 🔹 Controles de teclado
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(z + 0.1, 3));
      } else if (e.key === "-") {
        setZoom((z) => Math.max(z - 0.1, 0.5));
      } else if (e.key === "ArrowRight") {
        nextPage();
      } else if (e.key === "ArrowLeft") {
        prevPage();
      } else if (e.key === "Escape") {
        resetPages();
      } else if (e.key.toLowerCase() === "d") {
        setDoublePage((d) => !d);
      }
    },
    [nextPage, prevPage]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="flex justify-center items-center bg-gray-900 text-white min-h-screen overflow-auto"
      style={{ scrollBehavior: "smooth" }}
    >
      <div
        className={`flex ${
          doublePage ? "flex-row gap-4" : "flex-col"
        } justify-center items-center`}
        style={{
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
            className={`${
              doublePage ? "max-w-[45vw]" : "max-w-[80vw]"
            } max-h-[90vh] object-contain rounded shadow-md`}
          />
        ))}
      </div>

      {/* 🔹 Indicador visual de modo */}
      <div className="fixed bottom-4 right-4 text-sm opacity-70">
        {doublePage ? "📖 Doble página" : "📄 Una página"}  
      </div>
    </div>
  );
}

export default Reader;
