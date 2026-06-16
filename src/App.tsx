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
import Button from "./components/Button";
import { getRecentFiles, saveRecentFiles, addRecentFile } from "./utils/recentFiles";
import { applyTheme, getTheme, type Theme } from "./utils/theme";
import { applyAccent, getAccent, type AccentId } from "./utils/accent";
import { getLastAppView, saveLastAppView, getShowProgressBar, saveShowProgressBar, getShowPageCount, saveShowPageCount, getAutoBackup, saveAutoBackup, getKeepDataOnRemove, saveKeepDataOnRemove, getFavoritesRespectFolders, saveFavoritesRespectFolders } from "./utils/settingsStore";
import { runAutoBackupIfDue } from "./utils/backup";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { basename } from "./utils/folderUtils";
import { getEntryByPath } from "./utils/libraryStore";
import { startLibraryReadingSession } from "./utils/readingSession";
import { setWindowTitle } from "./utils/appWindow";
import { invoke } from "@tauri-apps/api/core";
import { detectKind, loadPages, IMAGE_EXTS } from "./loaders";

type AppView = "home" | "library" | "reader";

// Shape returned by the `take_window_file` IPC: the file this window should open
// on mount, plus the library it belongs to (null for CLI / file-association
// launches). Mirrors the Rust `PendingFile` struct.
type PendingFile = { path: string; library_id: string | null };

// Only the stable "main" window runs the startup auto-backup, so multiple
// windows of the single-instance process don't each trigger one.
const MAIN_WINDOW_LABEL = "main";

function App() {
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [startPage, setStartPage] = useState(0);
  const [pageNames, setPageNames] = useState<string[] | undefined>(undefined);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [accent, setAccent] = useState<AccentId>(getAccent);
  const [language, setLanguage] = useState(i18n.language);
  const [view, setView] = useState<AppView>("home");
  const [returnTo, setReturnTo] = useState<"home" | "library">("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showProgressBar, setShowProgressBar] = useState(false);
  const [showPageCount, setShowPageCount] = useState(false);
  const [autoBackup, setAutoBackup] = useState(false);
  const [keepDataOnRemove, setKeepDataOnRemove] = useState(true);
  const [favoritesRespectFolders, setFavoritesRespectFolders] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // Once the library has been visited it stays mounted (hidden via CSS when not
  // active) for the rest of the session, so its state, scroll position and warm
  // thumbnail cache survive entering/leaving the reader.
  const [libraryMounted, setLibraryMounted] = useState(false);
  const { t } = useTranslation();

  const blobUrlsRef = useRef<string[]>([]);
  const onCompleteRef = useRef<(() => void) | null>(null);
  const onPagesLoadedRef = useRef<((total: number) => void) | null>(null);
  // Library context of the file currently being read (when opened from the
  // library), so sibling navigation (Ctrl+Arrow) can resolve the next file's
  // entry and keep its reading state in sync.
  const activeLibraryIdRef = useRef<string | null>(null);
  const viewInitializedRef = useRef(false);
  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  const startupCheckedRef = useRef(false);

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applyAccent(accent); }, [accent]);

  const handleToggleTheme = useCallback(() =>
    setTheme(prev => prev === "dark" ? "light" : "dark"), []);

  const handleSetAccent = useCallback((a: AccentId) => setAccent(a), []);

  const handleSetLanguage = useCallback((lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("kreader-language", lang);
    setLanguage(lang);
  }, []);

  useEffect(() => {
    getRecentFiles().then(setRecentFiles);
    getShowProgressBar().then(setShowProgressBar);
    getShowPageCount().then(setShowPageCount);
    getAutoBackup().then(setAutoBackup);
    getKeepDataOnRemove().then(setKeepDataOnRemove);
    getFavoritesRespectFolders().then(setFavoritesRespectFolders);
    if (getCurrentWindow().label === MAIN_WINDOW_LABEL) {
      runAutoBackupIfDue();
    }
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

  const handleToggleProgressBar = useCallback(async () => {
    setShowProgressBar((prev) => {
      const next = !prev;
      saveShowProgressBar(next).catch(console.error);
      return next;
    });
  }, []);

  const handleTogglePageCount = useCallback(() => {
    setShowPageCount((prev) => {
      const next = !prev;
      saveShowPageCount(next).catch(console.error);
      return next;
    });
  }, []);

  const handleToggleAutoBackup = useCallback(() => {
    setAutoBackup((prev) => {
      const next = !prev;
      saveAutoBackup(next).catch(console.error);
      return next;
    });
  }, []);

  const handleToggleKeepDataOnRemove = useCallback(() => {
    setKeepDataOnRemove((prev) => {
      const next = !prev;
      saveKeepDataOnRemove(next).catch(console.error);
      return next;
    });
  }, []);

  const handleToggleFavoritesRespectFolders = useCallback(() => {
    setFavoritesRespectFolders((prev) => {
      const next = !prev;
      saveFavoritesRespectFolders(next).catch(console.error);
      return next;
    });
  }, []);

  const handleRefreshMetadata = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
  }, []);

  const handleOpen = useCallback(async (
    path: string,
    from: "home" | "library" = "home",
    onComplete?: () => void,
    onPagesLoaded?: (total: number) => void,
  ) => {
    onCompleteRef.current = onComplete ?? null;
    onPagesLoadedRef.current = onPagesLoaded ?? null;
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
      onPagesLoaded?.(result.pages.length);
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
    setWindowTitle();
    setView(returnTo);
  }, [resetState, returnTo]);

  useEffect(() => {
    if (startupCheckedRef.current) return;
    startupCheckedRef.current = true;
    (async () => {
      const [savedView, startup] = await Promise.all([
        getLastAppView(),
        invoke<PendingFile | null>("take_window_file"),
      ]);
      if (startup) {
        // When the file belongs to a library (spawned via the library's "Open in
        // new window" action), keep that library's reading state in sync the same
        // way sibling navigation does — straight to disk, since no LibraryView is
        // mounted in this window.
        const entry = startup.library_id
          ? await getEntryByPath(startup.library_id, startup.path)
          : null;
        if (entry) {
          const { onComplete, onPagesLoaded } = startLibraryReadingSession(entry);
          handleOpen(startup.path, "home", onComplete, onPagesLoaded);
        } else {
          handleOpen(startup.path, "home");
        }
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

  useEffect(() => {
    if (view === "library") setLibraryMounted(true);
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

  const handlePdfPagesLoaded = useCallback((total: number) => {
    onPagesLoadedRef.current?.(total);
  }, []);

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
      // Show the spinner before resolving the library entry: getEntryByPath
      // awaits, and without loading=true that gap renders the empty reader
      // chrome (flicker) between clearing the old comic and loading the next.
      setLoading(true);
      resetState();
      const libraryId = returnTo === "library" ? activeLibraryIdRef.current : null;
      if (libraryId) {
        const entry = await getEntryByPath(libraryId, e.detail);
        if (entry) {
          const { onComplete, onPagesLoaded } = startLibraryReadingSession(entry);
          await handleOpen(e.detail, returnTo, onComplete, onPagesLoaded);
          return;
        }
      }
      await handleOpen(e.detail, returnTo);
    };

    window.addEventListener("openNewCbz", handleOpenNewCbz as EventListener);
    return () => window.removeEventListener("openNewCbz", handleOpenNewCbz as EventListener);
  }, [handleOpen, resetState, returnTo]);

  return (
    <>
      {/* App chrome (home/library). Hidden — not unmounted — while reading so
          LibraryView keeps its state, scroll and warm thumbnail cache. */}
      <div className={view === "reader"
        ? "hidden"
        : "flex flex-col h-screen overflow-hidden text-[var(--text-primary)] font-sans"}>
        <NavBar
          view={view === "reader" ? "home" : view}
          onNavigate={setView}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Content area — offset by NavBar height (h-11 = 44px) */}
        <div className="flex-1 pt-11 min-h-0 overflow-hidden">
          {/* LibraryView stays mounted for the rest of the session once
              visited; only hidden when it isn't the active view. */}
          {libraryMounted && (
            <div className={view === "library" ? "h-full" : "hidden"}>
              <LibraryView
                active={view === "library"}
                showProgressBar={showProgressBar}
                showPageCount={showPageCount}
                favoritesRespectFolders={favoritesRespectFolders}
                refreshTrigger={refreshTrigger}
                onOpen={(path, onComplete, onPagesLoaded, libraryId) => {
                  activeLibraryIdRef.current = libraryId ?? null;
                  handleOpen(path, "library", onComplete, onPagesLoaded);
                }}
              />
            </div>
          )}
          {view === "home" && (
          /* Home view */
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-8 py-16">
              <p
                className="kr-rise text-xs font-semibold uppercase tracking-[0.28em] mb-5"
                style={{ color: "var(--accent)", animationDelay: "0.05s" }}
              >
                {t("home.eyebrow")}
              </p>
              <h1
                className="kr-rise font-display font-semibold leading-[0.98] tracking-tight"
                style={{ fontSize: "clamp(2.75rem, 7vw, 4.75rem)", animationDelay: "0.12s" }}
              >
                {t(recentFiles.length > 0 ? "home.titleLead" : "home.titleLeadEmpty")}{" "}
                <span style={{ color: "var(--accent)", textShadow: "0 0 38px var(--glow)" }}>
                  {t(recentFiles.length > 0 ? "home.titleAccent" : "home.titleAccentEmpty")}
                </span>
              </h1>
              <p
                className="kr-rise mt-6 max-w-md text-lg leading-relaxed"
                style={{ color: "var(--text-secondary)", animationDelay: "0.22s" }}
              >
                {t(recentFiles.length > 0 ? "home.subtitle" : "home.subtitleEmpty")}
              </p>
              <div className="kr-rise mt-9" style={{ animationDelay: "0.3s" }}>
                <Button variant="primary" size="lg" onClick={openFileDialog}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h6l2 2h8v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                  </svg>
                  {t("home.openFile")}
                </Button>
              </div>

              {recentFiles.length > 0 && (
                <section className="kr-rise mt-16" style={{ animationDelay: "0.42s" }}>
                  <div className="flex items-baseline justify-between mb-4 pb-3 border-b"
                    style={{ borderColor: "var(--border-nav)" }}>
                    <h2 className="font-display text-xl font-medium">{t("home.recent")}</h2>
                    <button
                      onClick={handleClear}
                      className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                    >
                      {t("home.clear")}
                    </button>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {recentFiles.map((path) => (
                      <li key={path}>
                        <button
                          onClick={() => handleOpen(path, "home")}
                          className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--bg-tab-active)]"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
                            className="shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span className="truncate text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                            {basename(path)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Reader overlay — rendered above the hidden chrome so LibraryView is
          preserved underneath while reading. */}
      {view === "reader" && pdfData !== null && (
        <PDFReader data={pdfData} filePath={currentPath} onClose={handleClose} onLoadError={handlePdfLoadError} onLastPage={handleLastPage} onPagesLoaded={handlePdfPagesLoaded} />
      )}
      {view === "reader" && pdfData === null && pages.length > 0 && (
        <Reader pages={pages} onClose={handleClose} filePath={currentPath} startPage={startPage} pageNames={pageNames} onLastPage={handleLastPage} />
      )}

      {/* Loading overlay — above everything, dims whatever is underneath. */}
      {loading && (
        <div className="fixed inset-0 bg-black/40 flex flex-col items-center justify-center z-50">
          <div className="w-10 h-10 border-4 border-[var(--border-spinner)] border-t-transparent rounded-full animate-spin" />
          <span className="mt-4 text-white font-medium">{t("loading")}</span>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        accent={accent}
        onSetAccent={handleSetAccent}
        language={language}
        onSetLanguage={handleSetLanguage}
        showProgressBar={showProgressBar}
        onToggleProgressBar={handleToggleProgressBar}
        showPageCount={showPageCount}
        onTogglePageCount={handleTogglePageCount}
        autoBackup={autoBackup}
        onToggleAutoBackup={handleToggleAutoBackup}
        keepDataOnRemove={keepDataOnRemove}
        onToggleKeepDataOnRemove={handleToggleKeepDataOnRemove}
        favoritesRespectFolders={favoritesRespectFolders}
        onToggleFavoritesRespectFolders={handleToggleFavoritesRespectFolders}
        onRefreshMetadata={handleRefreshMetadata}
      />
    </>
  );
}

export default App;
