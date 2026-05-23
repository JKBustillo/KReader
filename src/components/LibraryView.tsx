import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { exists, rename, mkdir } from "@tauri-apps/plugin-fs";

import type { Library, LibraryEntry, SortDirection, SortField, Tag, ViewMode } from "../types/library";
import {
  getLibraries,
  addLibrary,
  removeLibrary,
  getEntries,
  upsertEntries,
  updateEntryPath,
  removeEntry,
  setFavorite,
  setReadingState,
  batchSetCustomTags,
} from "../utils/libraryStore";
import { getLibraryViewMode, saveLibraryViewMode, getSavedFolderFilter, saveFolderFilter } from "../utils/settingsStore";
import { parseAutoTags } from "../utils/parseTags";
import { getRelativeFolder } from "../utils/folderUtils";
import { LibraryDetailsRow, COL_WIDTHS, COL_STAR } from "./LibraryDetailsRow";
import LibraryCard from "./LibraryCard";
import TagEditor from "./TagEditor";

type ScannedFile = {
  path: string;
  filename: string;
  size_bytes: number;
  modified_secs: number;
};

type ContextMenuState = {
  x: number;
  y: number;
  entries: LibraryEntry[];
};

const TAGS_DROPDOWN_MAX_HEIGHT = 280;

// Session-only tag filter — survives LibraryView unmount (reader open/close)
// but resets when the app is restarted.
let sessionSelectedTags: Set<string> = new Set();

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

function MoveFolderModal({
  entries,
  folders,
  rootPath,
  onMove,
  onClose,
}: {
  entries: LibraryEntry[];
  folders: string[];
  rootPath: string;
  onMove: (entries: LibraryEntry[], folder: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const currentFolders = new Set(entries.map((e) => getRelativeFolder(e.currentPath, rootPath)));
  const destinations = folders.filter((f) => !currentFolders.has(f));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg shadow-2xl p-5 flex flex-col gap-4"
        style={{ background: "var(--bg-nav)", border: "1px solid var(--border-nav)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("library.moveToFolderTitle")}
          </h2>
          <button
            onClick={onClose}
            className="text-lg leading-none opacity-60 hover:opacity-100"
            style={{ color: "var(--text-muted)" }}
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {destinations.map((folder) => (
            <button
              key={folder}
              onClick={() => onMove(entries, folder)}
              className="text-left text-xs px-3 py-2 rounded transition-colors hover:bg-[var(--bg-tab-active)]"
              style={{ color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
            >
              {folder}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  entries,
  onConfirm,
  onClose,
}: {
  entries: LibraryEntry[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const message = entries.length === 1
    ? t("library.deleteConfirm", { name: entries[0].filename.replace(/\.[^.]+$/, "") })
    : t("library.deleteConfirmMany", { count: entries.length });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg shadow-2xl p-5 flex flex-col gap-4"
        style={{ background: "var(--bg-nav)", border: "1px solid var(--border-nav)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded transition-colors hover:bg-[var(--bg-tab-active)]"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border-nav)" }}
          >
            {t("library.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded transition-colors"
            style={{ background: "var(--color-danger)", color: "#fff" }}
          >
            {t("library.deleteConfirmBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryView({ onOpen }: { onOpen: (path: string, onComplete?: () => void) => void }) {
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tagEditorEntries, setTagEditorEntries] = useState<LibraryEntry[] | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set(sessionSelectedTags));
  const [tagsDropdownOpen, setTagsDropdownOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<Map<string, string[]>>(new Map());
  const [resolveTarget, setResolveTarget] = useState<{ entry: LibraryEntry; candidates: string[] } | null>(null);
  const [selectedFolders, setSelectedFolders] = useState<Map<string, "full" | "partial">>(new Map());
  const [foldersDropdownOpen, setFoldersDropdownOpen] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");
  const foldersDropdownContainerRef = useRef<HTMLDivElement>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<LibraryEntry[] | null>(null);
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const [deleteConfirmEntries, setDeleteConfirmEntries] = useState<LibraryEntry[] | null>(null);

  // Stable refs used inside callbacks to avoid stale closures without adding
  // frequently-changing values to useCallback dependency arrays.
  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  selectedIdsRef.current = selectedIds;
  const entriesRef = useRef<LibraryEntry[]>(entries);
  entriesRef.current = entries;
  const lastCtrlSelectedIdRef = useRef<string | null>(null);
  const sortedRef = useRef<LibraryEntry[]>([]);
  const tagsDropdownContainerRef = useRef<HTMLDivElement>(null);
  const folderFilterLoadedForLibRef = useRef<string | null>(null);

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

        const newAmbiguous = new Map<string, string[]>();
        const updatedEntries = await Promise.all(
          stored.map(async (entry) => {
            if (scannedByPath.has(entry.currentPath)) return entry;
            const matches = scanned.filter(
              (f) => f.filename === entry.filename && f.size_bytes === entry.sizeBytes
            );
            if (matches.length === 1) {
              await updateEntryPath(entry.id, entry.libraryId, matches[0].path);
              return { ...entry, currentPath: matches[0].path };
            }
            if (matches.length > 1) {
              newAmbiguous.set(entry.id, matches.map((f) => f.path));
            }
            return entry;
          })
        );
        setAmbiguousCandidates(newAmbiguous);

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
              readingState: "unread",
            });
          }
        }

        // Apply auto-parse to any entry that has no autoTags yet (new or pre-feature).
        const needsTagging = [...updatedEntries, ...newEntries].filter((e) => e.autoTags.length === 0);
        for (const entry of needsTagging) {
          entry.autoTags = parseAutoTags(entry.filename);
        }

        const allEntries = [...updatedEntries, ...newEntries];
        const toUpsert = [...newEntries, ...needsTagging.filter((e) => !newEntries.includes(e))];
        if (toUpsert.length > 0) await upsertEntries(activeLib.id, toUpsert);

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

  const handleOpen = useCallback(async (entry: LibraryEntry) => {
    if (entry.readingState !== "completed") {
      await setReadingState(entry.id, entry.libraryId, "in_progress");
      setEntries((prev) =>
        prev.map((e) => e.id === entry.id ? { ...e, readingState: "in_progress" as const } : e)
      );
    }
    const onComplete = entry.readingState !== "completed"
      ? () => {
          setReadingState(entry.id, entry.libraryId, "completed").catch(console.error);
          setEntries((prev) =>
            prev.map((e) => e.id === entry.id ? { ...e, readingState: "completed" as const } : e)
          );
        }
      : undefined;
    onOpen(entry.currentPath, onComplete);
  }, [onOpen]);

  const handleItemClick = useCallback((entry: LibraryEntry, e: MouseEvent) => {
    if (e.ctrlKey && e.shiftKey) {
      const last = lastCtrlSelectedIdRef.current;
      if (!last) {
        setSelectedIds((prev) => new Set([...prev, entry.id]));
        lastCtrlSelectedIdRef.current = entry.id;
        return;
      }
      const sortedList = sortedRef.current;
      const startIdx = sortedList.findIndex((s) => s.id === last);
      const endIdx = sortedList.findIndex((s) => s.id === entry.id);
      if (startIdx === -1 || endIdx === -1) return;
      const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const rangeIds = sortedList.slice(lo, hi + 1).map((s) => s.id);
      setSelectedIds((prev) => new Set([...prev, ...rangeIds]));
    } else if (e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(entry.id)) next.delete(entry.id);
        else next.add(entry.id);
        return next;
      });
      lastCtrlSelectedIdRef.current = entry.id;
    } else {
      setSelectedIds(new Set());
    }
  }, []);

  const handleContextMenu = useCallback((entry: LibraryEntry, x: number, y: number) => {
    const ids = selectedIdsRef.current;
    if (ids.has(entry.id) && ids.size > 1) {
      const menuEntries = entriesRef.current.filter((e) => ids.has(e.id));
      setContextMenu({ x, y, entries: menuEntries });
    } else {
      setSelectedIds(new Set());
      setContextMenu({ x, y, entries: [entry] });
    }
  }, []);

  const handleResetProgress = useCallback(async (targetEntries: LibraryEntry[]) => {
    for (const entry of targetEntries) {
      await setReadingState(entry.id, entry.libraryId, "unread");
    }
    const ids = new Set(targetEntries.map((e) => e.id));
    setEntries((prev) =>
      prev.map((e) => ids.has(e.id) ? { ...e, readingState: "unread" as const } : e)
    );
    setContextMenu(null);
  }, []);

  const handleMarkAsRead = useCallback(async (targetEntries: LibraryEntry[]) => {
    for (const entry of targetEntries) {
      await setReadingState(entry.id, entry.libraryId, "completed");
    }
    const ids = new Set(targetEntries.map((e) => e.id));
    setEntries((prev) =>
      prev.map((e) => ids.has(e.id) ? { ...e, readingState: "completed" as const } : e)
    );
    setContextMenu(null);
  }, []);

  const handleMoveToFolder = useCallback(async (targetEntries: LibraryEntry[], targetFolder: string) => {
    const rootPath = (activeLib?.rootPath ?? "").replace(/\\/g, "/");
    const destDir = targetFolder === "/" ? rootPath : `${rootPath}/${targetFolder}`;

    if (targetFolder !== "/") {
      await mkdir(destDir, { recursive: true });
    }

    const movedPaths = new Map<string, string>();
    for (const entry of targetEntries) {
      const newPath = `${destDir}/${entry.filename}`;
      const normalizedCurrent = entry.currentPath.replace(/\\/g, "/");
      if (normalizedCurrent === newPath) continue;
      await rename(entry.currentPath, newPath);
      await updateEntryPath(entry.id, entry.libraryId, newPath);
      movedPaths.set(entry.id, newPath);
    }

    setEntries((prev) =>
      prev.map((e) => movedPaths.has(e.id) ? { ...e, currentPath: movedPaths.get(e.id)! } : e)
    );
    setMoveFolderTarget(null);
  }, [activeLib]);

  const handleDeleteEntries = useCallback(async (targetEntries: LibraryEntry[]) => {
    for (const entry of targetEntries) {
      await invoke("trash_file", { path: entry.currentPath });
      await removeEntry(entry.id, entry.libraryId);
    }
    const deletedIds = new Set(targetEntries.map((e) => e.id));
    setEntries((prev) => prev.filter((e) => !deletedIds.has(e.id)));
    setSelectedIds((prev) => {
      if ([...prev].some((id) => deletedIds.has(id))) {
        const next = new Set(prev);
        for (const id of deletedIds) next.delete(id);
        return next;
      }
      return prev;
    });
    setDeleteConfirmEntries(null);
  }, []);

  const handleTagSave = useCallback(async (updates: { id: string; tags: Tag[] }[]) => {
    if (updates.length === 0) return;
    const firstEntry = entriesRef.current.find((e) => e.id === updates[0].id);
    if (!firstEntry) return;
    await batchSetCustomTags(firstEntry.libraryId, updates);
    const updateMap = new Map(updates.map(({ id, tags }) => [id, tags]));
    setEntries((prev) =>
      prev.map((e) => updateMap.has(e.id) ? { ...e, customTags: updateMap.get(e.id)! } : e)
    );
  }, []);

  const handleResolveLocation = useCallback(async (entry: LibraryEntry, chosenPath: string) => {
    await updateEntryPath(entry.id, entry.libraryId, chosenPath);
    setAmbiguousCandidates((prev) => {
      const next = new Map(prev);
      next.delete(entry.id);
      return next;
    });
    setNotFoundIds((prev) => {
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
    setEntries((prev) =>
      prev.map((e) => e.id === entry.id ? { ...e, currentPath: chosenPath } : e)
    );
    setResolveTarget(null);
  }, []);

  // Dismiss context menu on click-outside or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // Escape clears selection (runs regardless of contextMenu so Escape covers both).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIds(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    sessionSelectedTags = selectedTags;
  }, [selectedTags]);

  useEffect(() => {
    if (!activeLibId) {
      setSelectedFolders(new Map());
      return;
    }
    folderFilterLoadedForLibRef.current = null;
    getSavedFolderFilter(activeLibId).then((saved) => {
      setSelectedFolders(saved);
      folderFilterLoadedForLibRef.current = activeLibId;
    });
  }, [activeLibId]);

  useEffect(() => {
    if (!activeLibId || folderFilterLoadedForLibRef.current !== activeLibId) return;
    saveFolderFilter(activeLibId, selectedFolders).catch(console.error);
  }, [selectedFolders, activeLibId]);

  // Dismiss tags dropdown on click-outside.
  useEffect(() => {
    if (!tagsDropdownOpen) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (
        tagsDropdownContainerRef.current &&
        !tagsDropdownContainerRef.current.contains(e.target as Node)
      ) {
        setTagsDropdownOpen(false);
        setTagSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tagsDropdownOpen]);

  // Dismiss folders dropdown on click-outside.
  useEffect(() => {
    if (!foldersDropdownOpen) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (
        foldersDropdownContainerRef.current &&
        !foldersDropdownContainerRef.current.contains(e.target as Node)
      ) {
        setFoldersDropdownOpen(false);
        setFolderSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [foldersDropdownOpen]);

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

  // All tags across the library with their entry counts.
  const allTags = useMemo(() => {
    const map = new Map<string, { tag: Tag; count: number }>();
    for (const entry of entries) {
      for (const tag of [...entry.autoTags, ...entry.customTags]) {
        const existing = map.get(tag.value);
        if (existing) {
          existing.count++;
          if (!existing.tag.color && tag.color) existing.tag = { ...tag };
        } else {
          map.set(tag.value, { tag: { ...tag }, count: 1 });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aSelected = selectedTags.has(a.tag.value);
      const bSelected = selectedTags.has(b.tag.value);
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      return b.count - a.count;
    });
  }, [entries, selectedTags]);

  const allTagValues = useMemo(() => allTags.map(({ tag }) => tag.value), [allTags]);

  const allFolders = useMemo(() => {
    const rootPath = activeLib?.rootPath ?? "";
    const set = new Set<string>();
    for (const entry of entries) {
      set.add(getRelativeFolder(entry.currentPath, rootPath));
    }
    return Array.from(set).sort((a, b) => {
      if (a === "/") return -1;
      if (b === "/") return 1;
      return a.localeCompare(b);
    });
  }, [entries, activeLib]);

  const visibleTags = tagSearch.trim()
    ? allTags.filter((t) => t.tag.value.toLowerCase().includes(tagSearch.trim().toLowerCase()))
    : allTags;

  const filtered = entries.filter((e) => {
    if (showFavoritesOnly && !e.isFavorite) return false;
    if (search.trim() !== "" && !e.filename.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (selectedTags.size > 0) {
      const vals = new Set([...e.autoTags, ...e.customTags].map((t) => t.value));
      for (const tag of selectedTags) {
        if (!vals.has(tag)) return false;
      }
    }
    if (selectedFolders.size > 0) {
      const rootPath = activeLib?.rootPath ?? "";
      const entryFolder = getRelativeFolder(e.currentPath, rootPath);
      const matches = [...selectedFolders.entries()].some(([folder, mode]) => {
        if (mode === "full") {
          if (folder === "/") return true;
          return entryFolder === folder || entryFolder.startsWith(folder + "/");
        }
        return entryFolder === folder;
      });
      if (!matches) return false;
    }
    return true;
  });

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

  // Keep ref in sync for range-selection inside handleItemClick.
  sortedRef.current = sorted;

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
          {/* Folders filter dropdown */}
          <div ref={foldersDropdownContainerRef} className="relative">
            <button
              onClick={() => { setFoldersDropdownOpen((v) => !v); setFolderSearch(""); }}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{
                background: selectedFolders.size > 0 ? "var(--color-selection)" : "var(--bg-tab-active)",
                color: selectedFolders.size > 0 ? "#fff" : "var(--text-secondary)",
                border: "1px solid var(--border-nav)",
              }}
            >
              {t("library.folders")}{selectedFolders.size > 0 ? ` (${selectedFolders.size})` : ""}
            </button>

            {foldersDropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 rounded shadow-lg flex flex-col"
                style={{
                  width: "240px",
                  background: "var(--bg-nav)",
                  border: "1px solid var(--border-nav)",
                }}
              >
                <div className="p-2 border-b shrink-0" style={{ borderColor: "var(--border-nav)" }}>
                  <input
                    type="text"
                    value={folderSearch}
                    onChange={(e) => setFolderSearch(e.target.value)}
                    placeholder={t("library.searchFolders")}
                    className="w-full text-xs rounded px-2 py-1 outline-none"
                    style={{
                      background: "var(--bg-tab-active)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-nav)",
                    }}
                    autoFocus
                  />
                </div>
                <div style={{ overflowY: "auto", maxHeight: `${TAGS_DROPDOWN_MAX_HEIGHT}px` }}>
                  {(folderSearch.trim()
                    ? allFolders.filter((f) => f.toLowerCase().includes(folderSearch.trim().toLowerCase()))
                    : allFolders
                  ).map((folder) => {
                    const state = selectedFolders.get(folder);
                    return (
                      <button
                        key={folder}
                        onClick={() => {
                          setSelectedFolders((prev) => {
                            const next = new Map(prev);
                            const cur = next.get(folder);
                            if (!cur) next.set(folder, "full");
                            else if (cur === "full") next.set(folder, "partial");
                            else next.delete(folder);
                            return next;
                          });
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-[var(--bg-tab-active)]"
                        style={{ color: state ? "var(--text-primary)" : "var(--text-secondary)" }}
                      >
                        <span
                          className="shrink-0 w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
                          style={{
                            border: state ? "none" : "1px solid var(--text-muted)",
                            background: state === "full"
                              ? "var(--color-selection)"
                              : state === "partial"
                                ? "transparent"
                                : "transparent",
                            color: state === "full"
                              ? "#fff"
                              : state === "partial"
                                ? "var(--text-primary)"
                                : "transparent",
                            ...(state === "partial" ? { border: "1px solid var(--text-primary)" } : {}),
                          }}
                        >
                          {state === "full" ? "✓" : state === "partial" ? "—" : ""}
                        </span>
                        <span className="flex-1 truncate font-mono">{folder}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedFolders.size > 0 && (
                  <button
                    onClick={() => setSelectedFolders(new Map())}
                    className="px-3 py-1.5 text-xs border-t text-left transition-colors hover:bg-[var(--bg-tab-active)]"
                    style={{ borderColor: "var(--border-nav)", color: "var(--text-muted)" }}
                  >
                    ✕ {t("library.folders")} ({selectedFolders.size})
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tags filter dropdown */}
          <div ref={tagsDropdownContainerRef} className="relative">
            <button
              onClick={() => { setTagsDropdownOpen((v) => !v); setTagSearch(""); }}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{
                background: selectedTags.size > 0 ? "var(--color-selection)" : "var(--bg-tab-active)",
                color: selectedTags.size > 0 ? "#fff" : "var(--text-secondary)",
                border: "1px solid var(--border-nav)",
              }}
            >
              {t("library.tags")}{selectedTags.size > 0 ? ` (${selectedTags.size})` : ""}
            </button>

            {tagsDropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 rounded shadow-lg flex flex-col"
                style={{
                  width: "220px",
                  background: "var(--bg-nav)",
                  border: "1px solid var(--border-nav)",
                }}
              >
                <div className="p-2 border-b shrink-0" style={{ borderColor: "var(--border-nav)" }}>
                  <input
                    type="text"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder={t("library.searchTags")}
                    className="w-full text-xs rounded px-2 py-1 outline-none"
                    style={{
                      background: "var(--bg-tab-active)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-nav)",
                    }}
                    autoFocus
                  />
                </div>
                <div style={{ overflowY: "auto", maxHeight: `${TAGS_DROPDOWN_MAX_HEIGHT}px` }}>
                  {visibleTags.length === 0 && (
                    <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("library.noTags")}
                    </p>
                  )}
                  {visibleTags.map(({ tag, count }) => {
                    const active = selectedTags.has(tag.value);
                    return (
                      <button
                        key={tag.value}
                        onClick={() => {
                          setSelectedTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(tag.value)) next.delete(tag.value);
                            else next.add(tag.value);
                            return next;
                          });
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-[var(--bg-tab-active)]"
                        style={{
                          color: active ? "var(--text-primary)" : "var(--text-secondary)",
                          fontWeight: active ? 600 : undefined,
                        }}
                      >
                        <span
                          className="shrink-0 w-2 h-2 rounded-full"
                          style={{ background: tag.color ?? "var(--text-muted)" }}
                        />
                        <span className="flex-1 truncate">{tag.value}</span>
                        <span style={{ color: "var(--text-muted)" }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedTags.size > 0 && (
                  <button
                    onClick={() => setSelectedTags(new Set())}
                    className="px-3 py-1.5 text-xs border-t text-left transition-colors hover:bg-[var(--bg-tab-active)]"
                    style={{ borderColor: "var(--border-nav)", color: "var(--text-muted)" }}
                  >
                    ✕ {t("library.tags")} ({selectedTags.size})
                  </button>
                )}
              </div>
            )}
          </div>

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
          <div
            className="flex-1 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds(new Set()); }}
          >
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
                    ambiguous={ambiguousCandidates.has(entry.id)}
                    selected={selectedIds.has(entry.id)}
                    onOpen={handleOpen}
                    onSelect={handleItemClick}
                    onToggleFavorite={handleToggleFavorite}
                    onContextMenu={handleContextMenu}
                  />
                ))
              : (
                <div
                  className="p-4"
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "1rem" }}
                  onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds(new Set()); }}
                >
                  {sorted.map((entry) => (
                    <LibraryCard
                      key={entry.id}
                      entry={entry}
                      notFound={notFoundIds.has(entry.id)}
                      ambiguous={ambiguousCandidates.has(entry.id)}
                      selected={selectedIds.has(entry.id)}
                      onOpen={handleOpen}
                      onSelect={handleItemClick}
                      onToggleFavorite={handleToggleFavorite}
                      onContextMenu={handleContextMenu}
                    />
                  ))}
                </div>
              )
            }

            {contextMenu && (
              <div
                className="fixed z-50 rounded shadow-lg overflow-hidden"
                style={{
                  top: contextMenu.y,
                  left: contextMenu.x,
                  background: "var(--bg-nav)",
                  border: "1px solid var(--border-nav)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-tab-active)] transition-colors"
                  style={{ color: "var(--text-primary)" }}
                  onClick={() => {
                    setTagEditorEntries(contextMenu.entries);
                    setContextMenu(null);
                  }}
                >
                  {t("library.editTags")}
                </button>
                {contextMenu.entries.length === 1 && ambiguousCandidates.has(contextMenu.entries[0].id) && (
                  <button
                    className="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-tab-active)] transition-colors"
                    style={{ color: "var(--color-progress-inprogress)" }}
                    onClick={() => {
                      const entry = contextMenu.entries[0];
                      setResolveTarget({ entry, candidates: ambiguousCandidates.get(entry.id)! });
                      setContextMenu(null);
                    }}
                  >
                    {t("library.resolveLocation")}
                  </button>
                )}
                <button
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-tab-active)] transition-colors"
                  style={{ color: "var(--text-primary)" }}
                  onClick={() => handleResetProgress(contextMenu.entries)}
                >
                  {t("library.resetProgress")}
                </button>
                <button
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-tab-active)] transition-colors"
                  style={{ color: "var(--text-primary)" }}
                  onClick={() => handleMarkAsRead(contextMenu.entries)}
                >
                  {t("library.markAsRead")}
                </button>
                <button
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-tab-active)] transition-colors"
                  style={{ color: "var(--text-primary)" }}
                  onClick={async () => {
                    const entries = contextMenu.entries;
                    const folders = await invoke<string[]>("list_subdirs", { root: activeLib!.rootPath });
                    setAvailableFolders(folders);
                    setMoveFolderTarget(entries);
                    setContextMenu(null);
                  }}
                >
                  {t("library.moveToFolder")}
                </button>
                <button
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-tab-active)] transition-colors"
                  style={{ color: "var(--color-danger)" }}
                  onClick={() => {
                    setDeleteConfirmEntries(contextMenu.entries);
                    setContextMenu(null);
                  }}
                >
                  {t("library.delete")}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {tagEditorEntries && (
        <TagEditor
          entries={tagEditorEntries}
          onSave={handleTagSave}
          onClose={() => setTagEditorEntries(null)}
          allTagValues={allTagValues}
        />
      )}

      {moveFolderTarget && (
        <MoveFolderModal
          entries={moveFolderTarget}
          folders={availableFolders}
          rootPath={activeLib?.rootPath ?? ""}
          onMove={handleMoveToFolder}
          onClose={() => setMoveFolderTarget(null)}
        />
      )}

      {deleteConfirmEntries && (
        <DeleteConfirmModal
          entries={deleteConfirmEntries}
          onConfirm={() => handleDeleteEntries(deleteConfirmEntries)}
          onClose={() => setDeleteConfirmEntries(null)}
        />
      )}

      {resolveTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setResolveTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-lg shadow-2xl p-5 flex flex-col gap-4"
            style={{ background: "var(--bg-nav)", border: "1px solid var(--border-nav)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("library.resolveLocationTitle")}
              </h2>
              <button
                onClick={() => setResolveTarget(null)}
                className="text-lg leading-none opacity-60 hover:opacity-100"
                style={{ color: "var(--text-muted)" }}
              >
                ×
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("library.resolveLocationHint")}
            </p>
            <div className="flex flex-col gap-1">
              {resolveTarget.candidates.map((path) => {
                const rootPath = activeLib?.rootPath ?? "";
                const normalized = path.replace(/\\/g, "/");
                const normalizedRoot = rootPath.replace(/\\/g, "/");
                const display = normalized.startsWith(normalizedRoot + "/")
                  ? normalized.slice(normalizedRoot.length + 1)
                  : normalized;
                return (
                  <button
                    key={path}
                    onClick={() => handleResolveLocation(resolveTarget.entry, path)}
                    className="text-left text-xs px-3 py-2 rounded transition-colors hover:bg-[var(--bg-tab-active)]"
                    style={{
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-nav)",
                    }}
                  >
                    {display}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LibraryView;
