import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import JSZip from "jszip";
import Reader from "./components/Reader";

function App() {
  const [pages, setPages] = useState<string[]>([]);

  const openCbz = async () => {
    const filePath = await open({
      filters: [{ name: "Comic book", extensions: ["cbz"] }],
    });

    if (!filePath) return;

    const data = await readFile(filePath);
    const zip = await JSZip.loadAsync(data);

    const entries = Object.keys(zip.files)
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const imgs: string[] = [];
    for (const name of entries) {
      const file = zip.file(name);
      if (file) {
        const blob = await file.async("blob");
        imgs.push(URL.createObjectURL(blob));
      }
    }

    setPages(imgs);
  };

  const resetPages = () => {
    setPages([]);
  };

  if (pages.length > 0)  {
    return <Reader pages={pages} resetPages={resetPages} />;
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
      </div>
      <footer className="absolute bottom-4 text-xs text-gray-600">
        v0.1 — hecho con ❤️ en Tauri + React
      </footer>
    </div>
  );
}

export default App;
