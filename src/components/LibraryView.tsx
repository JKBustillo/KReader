import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";

import type { Library, LibraryEntry, SortDirection, SortField, ViewMode } from "../types/library";
import {
  getLibraries,
  addLibrary,
  removeLibrary,
  getEntries,
  upsertEntries,
  updateEntryPath,
  setFavorite,
} from "../utils/libraryStore";
import { getLibraryViewMode, saveLibraryViewMode } from "../utils/settingsStore";
import { LibraryDetailsRow, COL_WIDTHS, COL_STAR } from "./LibraryDetailsRow";
import LibraryCard from "./LibraryCard";

type ScannedFile = {
  path: string;
  filename: string;
  size_bytes: number;
  modified_secs: number;
};

function makeEntryId(filename: string, sizeBytes: number): string {
  return `${filename}::${sizeBytes}`;
}

function DetailsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function LibraryView({ onOpen }: { onOpen: (path: string) => void }) {
  const { t } = useTranslation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [activeLibId, setActiveLibId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [notFoundIds, setNotFoundIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("details");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const activeLib = libraries.find((l) => l.id === activeLibId) ?? null;

  useEffect(() => {
    getLibraries().then((libs) => {
      setLibraries(libs);
      if (libs.length > 0) setActiveLibId(libs[0].id);
    });
    getLibraryViewMode().then(setViewMode);
  }, []);

  const handleViewModeToggle = () => {
    const next: ViewMode = viewMode === "details" ? "grid" : "details";
    setViewMode(next);
    saveLibraryViewMode(next);
  };

  const scanRef = useRef(false);
  useEffect(() => {
    if (!activeLib) return;
    if (scanRef.current) return;
    scanRef.current = true;

    (async () => {
      setScanning(true);
      try {
        const [scanned, stored] = await Promise.all([
          invoke<ScannedFile[]>("scan_library", { root: activeLib.rootPath }),
          getEntries(activeLib.id),
        ]);

        const scannedByPath = new Map(scanned.map((f) => [f.path, f]));
        const storedById = new Map(stored.map((e) => [e.id, e]));

        const updatedEntries = await Promise.all(
          stored.map(async (entry) => {
            if (scannedByPath.has(entry.currentPath)) return entry;
            const relocated = scanned.find(
              (f) => f.filename === entry.filename && f.size_bytes === entry.sizeBytes
            );
            if (relocated) {
              await updateEntryPath(entry.id, entry.libraryId, relocated.path);
              return { ...entry, currentPath: relocated.path };
            }
            return entry;
          })
        );

        const now = Math.floor(Date.now() / 1000);
        const newEntries: LibraryEntry[] = [];
        for (const file of scanned) {
          const id = makeEntryId(file.filename, file.size_bytes);
          if (!storedById.has(id)) {
            newEntries.push({
              id,
              libraryId: activeLib.id,
              currentPath: file.path,
              filename: file.filename,
              sizeBytes: file.size_bytes,
              modifiedAt: file.modified_secs,
              autoTags: [],
              customTags: [],
              isFavorite: false,
              addedAt: now,
            });
          }
        }

        const allEntries = [...updatedEntries, ...newEntries];
        if (newEntries.length > 0) await upsertEntries(activeLib.id, newEntries);

        const missing = new Set<string>();
        for (const entry of allEntries) {
          if (!scannedByPath.has(entry.currentPath)) {
            const fileExists = await exists(entry.currentPath);
            if (!fileExists) missing.add(entry.id);
          }
        }

        setEntries(allEntries);
        setNotFoundIds(missing);
      } finally {
        setScanning(false);
        scanRef.current = false;
      }
    })();
  }, [activeLib]);

  const handleAddLibrary = async () => {
    const folder = await open({ directory: true, multiple: false });
    if (!folder || typeof folder !== "string") return;
    const name = folder.split(/[\\/]/).pop() ?? folder;
    const lib = await addLibrary(name, folder);
    setLibraries((prev) => [...prev, lib]);
    setActiveLibId(lib.id);
    setEntries([]);
  };

  const handleToggleFavorite = useCallback(async (entry: LibraryEntry) => {
    const next = !entry.isFavorite;
    await setFavorite(entry.id, entry.libraryId, next);
    setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, isFavorite: next } : e));
  }, []);

  const handleRemoveLibrary = useCallback(async () => {
    if (!activeLib) return;
    await removeLibrary(activeLib.id);
    const updated = libraries.filter((l) => l.id !== activeLib.id);
    setLibraries(updated);
    setActiveLibId(updated.length > 0 ? updated[0].id : null);
    setEntries([]);
    setNotFoundIds(new Set());
  }, [activeLib, libraries]);

  const handleSortClick = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const sortIndicator = (field: SortField) =>
    sortField !== field ? null : (sortDir === "asc" ? " ↑" : " ↓");

  const filtered = entries.filter(
    (e) =>
      (!showFavoritesOnly || e.isFavorite) &&
      (search.trim() === "" || e.filename.toLowerCase().includes(search.trim().toLowerCase()))
  );

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name":   cmp = a.filename.localeCompare(b.filename, undefined, { numeric: true }); break;
      case "size":   cmp = a.sizeBytes - b.sizeBytes; break;
      case "date":   cmp = a.modifiedAt - b.modifiedAt; break;
      case "folder": {
        const fa = a.currentPath.replace(/\\/g, "/").lastIndexOf("/");
        const fb = b.currentPath.replace(/\\/g, "/").lastIndexOf("/");
        cmp = a.currentPath.slice(0, fa).localeCompare(b.currentPath.slice(0, fb));
        break;
      }
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const colHeaderClass = "flex items-center gap-1 cursor-pointer select-none text-xs font-medium uppercase tracking-wide hover:text-[var(--text-primary)] transition-colors";

  return (
    <div className="flex flex-col h-full" style={{ color: "var(--text-primary)" }}>
      {/* Library selector + view toggle + actions */}
      <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0" style={{ borderColor: "var(--border-nav)" }}>
        {libraries.length > 1 && (
          <select
            value={activeLibId ?? ""}
            onChange={(e) => { setActiveLibId(e.target.value); setEntries([]); setSearch(""); }}
            className="text-sm rounded px-2 py-1"
            style={{ background: "var(--bg-tab-active)", color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
          >
            {libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>{lib.name}</option>
            ))}
          </select>
        )}
        {activeLib && libraries.length <= 1 && (
          <span className="text-sm font-medium truncate" style={{ color: "var(--text-secondary)" }}>
            {activeLib.name}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Favorites filter */}
          <button
            onClick={() => setShowFavoritesOnly((v) => !v)}
            title={t("library.favoritesOnly")}
            className="p-1.5 rounded transition-colors"
            style={{
              background: showFavoritesOnly ? "var(--color-favorite)" : "var(--bg-tab-active)",
              color: showFavoritesOnly ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border-nav)",
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill={showFavoritesOnly ? "currentColor" : "none"}
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>

          {/* View mode toggle */}
          <button
            onClick={handleViewModeToggle}
            title={viewMode === "details" ? t("library.viewGrid") : t("library.viewDetails")}
            className="p-1.5 rounded transition-colors"
            style={{
              background: "var(--bg-tab-active)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-nav)",
            }}
          >
            {viewMode === "details" ? <GridIcon /> : <DetailsIcon />}
          </button>

          {activeLib && (
            <button
              onClick={handleRemoveLibrary}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
              title={t("library.removeLibrary")}
            >
              ✕
            </button>
          )}
          <button
            onClick={handleAddLibrary}
            className="text-xs px-3 py-1 rounded transition-colors"
            style={{ background: "var(--bg-tab-active)", color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
          >
            + {t("library.addLibrary")}
          </button>
        </div>
      </div>

      {libraries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-8 text-center" style={{ color: "var(--text-muted)" }}>
          <p className="max-w-sm">{t("library.noLibraries")}</p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="px-4 py-2 shrink-0 border-b" style={{ borderColor: "var(--border-nav)" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("library.search")}
              className="w-full text-sm rounded px-3 py-1.5 outline-none"
              style={{
                background: "var(--bg-tab-active)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-nav)",
              }}
            />
          </div>

          {/* Column headers — details mode only */}
          {viewMode === "details" && (
            <div
              className="flex items-center gap-4 px-4 py-2 border-b shrink-0"
              style={{ borderColor: "var(--border-nav)", color: "var(--text-muted)" }}
            >
              <div className={COL_STAR} />
              <button className={`${colHeaderClass} ${COL_WIDTHS.name}`} onClick={() => handleSortClick("name")}>
                {t("library.colName")}{sortIndicator("name")}
              </button>
              <button className={`${colHeaderClass} ${COL_WIDTHS.size} justify-end`} onClick={() => handleSortClick("size")}>
                {t("library.colSize")}{sortIndicator("size")}
              </button>
              <button className={`${colHeaderClass} ${COL_WIDTHS.date}`} onClick={() => handleSortClick("date")}>
                {t("library.colDate")}{sortIndicator("date")}
              </button>
              <button className={`${colHeaderClass} ${COL_WIDTHS.folder}`} onClick={() => handleSortClick("folder")}>
                {t("library.colFolder")}{sortIndicator("folder")}
              </button>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {scanning && (
              <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mr-2"
                  style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }} />
                {t("library.scanning")}
              </div>
            )}
            {!scanning && sorted.length === 0 && (
              <div className="flex items-center justify-center py-8 px-8 text-center" style={{ color: "var(--text-muted)" }}>
                {t("library.empty")}
              </div>
            )}

            {viewMode === "details"
              ? sorted.map((entry) => (
                  <LibraryDetailsRow
                    key={entry.id}
                    entry={entry}
                    rootPath={activeLib?.rootPath ?? ""}
                    notFound={notFoundIds.has(entry.id)}
                    onOpen={(e) => onOpen(e.currentPath)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))
              : (
                <div className="p-4" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "1rem" }}>
                  {sorted.map((entry) => (
                    <LibraryCard
                      key={entry.id}
                      entry={entry}
                      notFound={notFoundIds.has(entry.id)}
                      onOpen={(e) => onOpen(e.currentPath)}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>
              )
            }
          </div>
        </>
      )}
    </div>
  );
}

export default LibraryView;
