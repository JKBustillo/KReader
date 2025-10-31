import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import JSZip from "jszip";

import Reader from "./components/Reader";
import { getRecentFiles, clearRecentFiles, addRecentFile } from "./utils/recentFiles";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

function App() {
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  useEffect(() => {
    getRecentFiles().then(setRecentFiles);

    const handleDoubleClick = async () => {
      const win = getCurrentWindow();
      const isFull = await win.isFullscreen();
      await win.setFullscreen(!isFull);
    };

    window.addEventListener("dblclick", handleDoubleClick);
    return () => window.removeEventListener("dblclick", handleDoubleClick);
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("openCbzFromSystem", async (event) => {
      const path = event.payload;
      await handleOpen(path);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const handleOpen = async (path: string) => {
    setLoading(true);

    setCurrentPath(path);
    const data = await readFile(path);
    const zip = await JSZip.loadAsync(data);

    const imageEntries = Object.values(zip.files).filter(
      (file) =>
        !file.dir &&
        /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)
    );

    imageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const images = await Promise.all(
      imageEntries.map(async (file) => {
        const blob = await file.async("blob");
        return URL.createObjectURL(blob);
      })
    );

    setPages(images);
    setLoading(false);
  };

  const openCbz = async () => {
    const filePath = await open({
      filters: [{ name: "Comic book", extensions: ["cbz"] }],
    });

    if (!filePath) return;

    await handleOpen(filePath);

    const updated = await addRecentFile(filePath as string);
    setRecentFiles(updated);
  };

  const handleClear = async () => {
    await clearRecentFiles();
    setRecentFiles([]);
  };

  const resetPages = () => {
    setPages([]);
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const key = e.key;

      switch (key) {
        case "f":
        case "F":
          (async () => {
            const win = getCurrentWindow();
            const isFull = await win.isFullscreen();
            await win.setFullscreen(!isFull);
          })();
          break;

        case "x":
          // 🔹 Cierra completamente la app
          getCurrentWindow().close();
          break;

        default:
          break;
      }
    },
    []
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handleOpenNewCbz = async (event: Event) => {
      const e = event as CustomEvent<string>;

      const newPath = e.detail;
      if (newPath) {
        await handleOpen(newPath); // tu función actual que extrae imágenes
      }
    };

    window.addEventListener("openNewCbz", handleOpenNewCbz as EventListener);
    return () => window.removeEventListener("openNewCbz", handleOpenNewCbz as EventListener);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-[#1a1b1e] text-gray-200 font-sans">
        <div className="relative w-full h-full">
          {loading && (
            <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center z-50">
              <div className="w-10 h-10 border-4 border-gray-200 border-t-transparent rounded-full animate-spin" />
              <span className="mt-4 text-white font-medium">Abriendo archivo...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (pages.length > 0) {
    return <Reader pages={pages} resetPages={resetPages} filePath={currentPath} />;
  }

  return (
    <div className="flex flex-col justify-center items-center min-h-screen bg-[#1a1b1e] text-gray-200 font-sans">
      <div className="text-center">
        <h1 className="text-3xl font-semibold mb-6 tracking-wide">
          📚 KReader
        </h1>
        <p className="mb-8 text-gray-400">
          Lector ligero para CBZ / CBR / EPUB (en desarrollo)
        </p>
        <button
          onClick={openCbz}
          className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-indigo-500 hover:to-blue-500 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg"
        >
          Abrir archivo CBZ
        </button>

        {recentFiles.length > 0 && (
          <div className="mt-8 w-80">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-semibold">Recientes</h2>
              <button
                onClick={handleClear}
                className="text-sm text-gray-400 hover:text-gray-200"
              >
                Limpiar
              </button>
            </div>

            <ul className="space-y-2">
              {recentFiles.map((path) => (
                <li
                  key={path}
                  className="truncate cursor-pointer hover:text-blue-400"
                  onClick={() => handleOpen(path)}
                >
                  {path.split(/[\\/]/).pop()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <footer className="absolute bottom-4 text-xs text-gray-600">
        v0.1 — hecho con ❤️ en Tauri + React
      </footer>
    </div>
  );
}

export default App;
