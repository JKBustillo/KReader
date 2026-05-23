import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

import Reader from "./components/Reader";
import PDFReader from "./components/PDFReader";
import NavBar from "./components/NavBar";
import LibraryView from "./components/LibraryView";
import SettingsModal from "./components/SettingsModal";
import { getRecentFiles, saveRecentFiles, addRecentFile } from "./utils/recentFiles";
import { applyTheme, getTheme, type Theme } from "./utils/theme";
import { getLastAppView, saveLastAppView } from "./utils/settingsStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { detectKind, loadPages, IMAGE_EXTS } from "./loaders";

type AppView = "home" | "library" | "reader";

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
  const [view, setView] = useState<AppView>("home");
  const [returnTo, setReturnTo] = useState<"home" | "library">("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { t } = useTranslation();

  const blobUrlsRef = useRef<string[]>([]);
  const onCompleteRef = useRef<(() => void) | null>(null);
  const viewInitializedRef = useRef(false);
  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  const startupCheckedRef = useRef(false);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const handleToggleTheme = useCallback(() =>
    setTheme(prev => prev === "dark" ? "light" : "dark"), []);

  const handleSetLanguage = useCallback((lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("kreader-language", lang);
    setLanguage(lang);
  }, []);

  useEffect(() => {
    getRecentFiles().then(setRecentFiles);
  }, []);

  // Clears reader state without changing the current view. Used internally
  // before loading a sibling file (Ctrl+Arrow) so the old content is swept
  // away while the spinner shows, without navigating away from the reader.
  const resetState = useCallback(() => {
    revokeBlobUrls();
    setPages([]);
    setPdfData(null);
  }, [revokeBlobUrls]);

  const handleLastPage = useCallback(() => {
    onCompleteRef.current?.();
    onCompleteRef.current = null;
  }, []);

  const handleOpen = useCallback(async (
    path: string,
    from: "home" | "library" = "home",
    onComplete?: () => void,
  ) => {
    onCompleteRef.current = onComplete ?? null;
    setLoading(true);
    setStartPage(0);
    setPageNames(undefined);
    resetState();
    setReturnTo(from);

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
        setView("reader");
        return;
      }

      const result = await loadPages(path);
      blobUrlsRef.current = result.pages.filter((u) => u.startsWith("blob:"));
      setPages(result.pages);
      if (result.pageNames) setPageNames(result.pageNames);
      if (result.startPage !== undefined) setStartPage(result.startPage);
      const updated = await addRecentFile(path);
      setRecentFiles(updated);
      setView("reader");
    } catch (err) {
      console.error("[handleOpen] error:", err);
      const newRecentFiles = recentFiles.filter((p) => p !== path);
      saveRecentFiles(newRecentFiles);
      setRecentFiles(newRecentFiles);
      setView(from);
    } finally {
      setLoading(false);
    }
  }, [recentFiles, resetState]);

  // Clears reader state and navigates back to where the file was opened from.
  const handleClose = useCallback(() => {
    resetState();
    getCurrentWindow().setTitle("KReader");
    setView(returnTo);
  }, [resetState, returnTo]);

  useEffect(() => {
    if (startupCheckedRef.current) return;
    startupCheckedRef.current = true;
    (async () => {
      const [savedView, startupPath] = await Promise.all([
        getLastAppView(),
        invoke<string | null>("get_startup_file"),
      ]);
      if (startupPath) {
        handleOpen(startupPath, "home");
      } else {
        setView(savedView);
      }
      viewInitializedRef.current = true;
    })();
  }, [handleOpen]);

  useEffect(() => {
    if (!viewInitializedRef.current) return;
    if (view === "home" || view === "library") {
      saveLastAppView(view).catch(console.error);
    }
  }, [view]);

  const openFileDialog = async () => {
    const filePath = await open({
      filters: [{ name: "Comics & Images", extensions: ["cbz", "cbr", "zip", "rar", "pdf", ...IMAGE_EXTS] }],
    });
    if (!filePath) return;
    await handleOpen(filePath, view === "library" ? "library" : "home");
  };

  const handleClear = async () => {
    await saveRecentFiles([]);
    setRecentFiles([]);
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
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      switch (e.key) {
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
      if (!e.detail) return;
      resetState();
      await handleOpen(e.detail, returnTo);
    };

    window.addEventListener("openNewCbz", handleOpenNewCbz as EventListener);
    return () => window.removeEventListener("openNewCbz", handleOpenNewCbz as EventListener);
  }, [handleOpen, resetState, returnTo]);

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-[var(--bg-primary)] font-sans">
        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center z-50">
          <div className="w-10 h-10 border-4 border-[var(--border-spinner)] border-t-transparent rounded-full animate-spin" />
          <span className="mt-4 text-white font-medium">{t("loading")}</span>
        </div>
      </div>
    );
  }

  if (view === "reader") {
    const settingsModal = <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} onToggleTheme={handleToggleTheme} language={language} onSetLanguage={handleSetLanguage} />;
    if (pdfData !== null) {
      return <>{settingsModal}<PDFReader data={pdfData} filePath={currentPath} onClose={handleClose} onLoadError={handlePdfLoadError} onLastPage={handleLastPage} /></>;
    }
    if (pages.length > 0) {
      return <>{settingsModal}<Reader pages={pages} onClose={handleClose} filePath={currentPath} startPage={startPage} pageNames={pageNames} onLastPage={handleLastPage} /></>;
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans">
      <NavBar
        view={view === "reader" ? "home" : view}
        onNavigate={setView}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Content area — offset by NavBar height (h-11 = 44px) */}
      <div className="flex-1 pt-11 min-h-0 overflow-hidden">
        {view === "library" ? (
          <LibraryView onOpen={(path, onComplete) => handleOpen(path, "library", onComplete)} />
        ) : (
          /* Home view */
          <div className="flex flex-col justify-center items-center h-full">
            <div className="text-center">
              <h1 className="text-3xl font-semibold mb-6 tracking-wide">
                📚 KReader
              </h1>
              <p className="mb-8 text-[var(--text-secondary)]">
                {t("home.subtitle")}
              </p>
              <button
                onClick={openFileDialog}
                className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-indigo-500 hover:to-blue-500 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg"
              >
                {t("home.openFile")}
              </button>

              {recentFiles.length > 0 && (
                <div className="mt-8 w-80">
                  <div className="flex justify-between items-center mb-2">
                    <h2 className="text-lg font-semibold">{t("home.recent")}</h2>
                    <button
                      onClick={handleClear}
                      className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      {t("home.clear")}
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {recentFiles.map((path) => (
                      <li
                        key={path}
                        className="truncate cursor-pointer hover:text-blue-400"
                        onClick={() => handleOpen(path, "home")}
                      >
                        {path.split(/[\\/]/).pop()}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        language={language}
        onSetLanguage={handleSetLanguage}
      />
    </div>
  );
}

export default App;
