import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

import Reader from "./components/Reader";
import PDFReader from "./components/PDFReader";
import { getRecentFiles, saveRecentFiles, addRecentFile } from "./utils/recentFiles";
import { applyTheme, getTheme, type Theme } from "./utils/theme";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { detectKind, loadPages, IMAGE_EXTS } from "./loaders";

function App() {
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [startPage, setStartPage] = useState(0);
  const [pageNames, setPageNames] = useState<string[] | undefined>(undefined);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [language, setLanguage] = useState(i18n.language);
  const { t } = useTranslation();

  // Track blob: URLs so we can revoke them when loading a new file or closing.
  const blobUrlsRef = useRef<string[]>([]);
  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  // Guard so get_startup_file only fires once even if handleOpen changes identity.
  const startupCheckedRef = useRef(false);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const handleToggleTheme = useCallback(() =>
    setTheme(prev => prev === 'dark' ? 'light' : 'dark'), []);

  const handleSetLanguage = useCallback((lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('kreader-language', lang);
    setLanguage(lang);
  }, []);

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

  const handleOpen = useCallback(async (path: string) => {
    setLoading(true);
    setStartPage(0);
    setPageNames(undefined);
    revokeBlobUrls();

    try {
      setCurrentPath(path);
      const kind = detectKind(path);

      if (kind === "unsupported") {
        throw new Error(`Unsupported format: ${path}`);
      }

      if (kind === "pdf") {
        const data = await readFile(path);
        setPdfData(data);
        const updated = await addRecentFile(path);
        setRecentFiles(updated);
        return;
      }

      const result = await loadPages(path);
      blobUrlsRef.current = result.pages.filter((u) => u.startsWith("blob:"));
      setPages(result.pages);
      if (result.pageNames) setPageNames(result.pageNames);
      if (result.startPage !== undefined) setStartPage(result.startPage);

      const updated = await addRecentFile(path);
      setRecentFiles(updated);
    } catch (err) {
      console.error("[handleOpen] error:", err);
      const newRecentFiles = recentFiles.filter((p) => p !== path);
      saveRecentFiles(newRecentFiles);
      setRecentFiles(newRecentFiles);
    } finally {
      setLoading(false);
    }
  }, [recentFiles, revokeBlobUrls]);

  useEffect(() => {
    if (startupCheckedRef.current) return;
    startupCheckedRef.current = true;
    invoke<string | null>("get_startup_file").then((path) => {
      if (path) handleOpen(path);
    });
  }, [handleOpen]);

  const openCbz = async () => {
    const filePath = await open({
      filters: [{ name: "Comics & Images", extensions: ["cbz", "cbr", "zip", "rar", "pdf", ...IMAGE_EXTS] }],
    });

    if (!filePath) return;

    await handleOpen(filePath);
  };

  const handleClear = async () => {
    await saveRecentFiles([]);
    setRecentFiles([]);
  };

  const resetPages = () => {
    revokeBlobUrls();
    setPages([]);
    setPdfData(null);
  };

  const handlePdfLoadError = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const updated = prev.filter((p) => p !== path);
      saveRecentFiles(updated);
      return updated;
    });
  }, []);

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
        case "X":
          getCurrentWindow().close();
          break;

        case "t":
        case "T":
          handleToggleTheme();
          break;

        default:
          break;
      }
    },
    [handleToggleTheme]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handleOpenNewCbz = async (event: Event) => {
      const e = event as CustomEvent<string>;
      if (e.detail) await handleOpen(e.detail);
    };

    window.addEventListener("openNewCbz", handleOpenNewCbz as EventListener);
    return () => window.removeEventListener("openNewCbz", handleOpenNewCbz as EventListener);
  }, [handleOpen]);

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-[var(--bg-primary)] font-sans">
        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center z-50">
          <div className="w-10 h-10 border-4 border-[var(--border-spinner)] border-t-transparent rounded-full animate-spin" />
          <span className="mt-4 text-white font-medium">{t('loading')}</span>
        </div>
      </div>
    );
  }

  if (pdfData !== null) {
    return <PDFReader data={pdfData} filePath={currentPath} resetPages={resetPages} onLoadError={handlePdfLoadError} />;
  }

  if (pages.length > 0) {
    return <Reader pages={pages} resetPages={resetPages} filePath={currentPath} startPage={startPage} pageNames={pageNames} />;
  }

  return (
    <div className="flex flex-col justify-center items-center min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans">

      {/* Controls — top right */}
      <div className="fixed top-4 right-4 flex items-center gap-3">
        {/* Language toggle */}
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => handleSetLanguage('es')}
            className={`transition-colors ${language === 'es' ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
          >
            ES
          </button>
          <span className="text-[var(--text-muted)]">|</span>
          <button
            onClick={() => handleSetLanguage('en')}
            className={`transition-colors ${language === 'en' ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
          >
            EN
          </button>
        </div>

        {/* Theme toggle */}
        <button
          onClick={handleToggleTheme}
          title={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          {theme === 'dark' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7zm0-5a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 17a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zM4.22 4.22a1 1 0 0 1 1.42 0l.7.71a1 1 0 0 1-1.42 1.41l-.7-.7a1 1 0 0 1 0-1.42zm13.72 13.72a1 1 0 0 1 1.41 0l.71.7a1 1 0 1 1-1.41 1.42l-.71-.71a1 1 0 0 1 0-1.41zM3 11a1 1 0 0 1 0 2H2a1 1 0 1 1 0-2h1zm19 0a1 1 0 0 1 0 2h-1a1 1 0 1 1 0-2h1zM5.64 17.66a1 1 0 0 1 0 1.41l-.7.71a1 1 0 1 1-1.42-1.41l.71-.71a1 1 0 0 1 1.41 0zm13.72-13.72a1 1 0 0 1 0 1.42l-.71.7a1 1 0 0 1-1.41-1.41l.7-.71a1 1 0 0 1 1.42 0z"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>
            </svg>
          )}
        </button>
      </div>

      <div className="text-center">
        <h1 className="text-3xl font-semibold mb-6 tracking-wide">
          📚 KReader
        </h1>
        <p className="mb-8 text-[var(--text-secondary)]">
          {t('home.subtitle')}
        </p>
        <button
          onClick={openCbz}
          className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-indigo-500 hover:to-blue-500 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg"
        >
          {t('home.openFile')}
        </button>

        {recentFiles.length > 0 && (
          <div className="mt-8 w-80">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-semibold">{t('home.recent')}</h2>
              <button
                onClick={handleClear}
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {t('home.clear')}
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
    </div>
  );
}

export default App;
