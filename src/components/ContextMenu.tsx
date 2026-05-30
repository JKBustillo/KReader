import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryEntry } from "../types/library";

const ITEM_CLASS = "block w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-tab-active)] transition-colors";

function ContextMenu({
  x,
  y,
  entries,
  ambiguousCandidates,
  onEditTags,
  onResolveLocation,
  onResetProgress,
  onMarkAsRead,
  onMoveToFolder,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  entries: LibraryEntry[];
  ambiguousCandidates: Map<string, string[]>;
  onEditTags: (entries: LibraryEntry[]) => void;
  onResolveLocation: (entry: LibraryEntry, candidates: string[]) => void;
  onResetProgress: (entries: LibraryEntry[]) => void;
  onMarkAsRead: (entries: LibraryEntry[]) => void;
  onMoveToFolder: (entries: LibraryEntry[]) => void;
  onDelete: (entries: LibraryEntry[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Dismiss on click-outside or Escape. Registered once via ref to avoid
  // re-subscription churn from an unstable onClose (see Modal/TagEditor).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const close = () => onCloseRef.current();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const single = entries.length === 1 ? entries[0] : null;
  const candidates = single ? ambiguousCandidates.get(single.id) : undefined;

  return (
    <div
      className="fixed z-50 rounded shadow-lg overflow-hidden"
      style={{ top: y, left: x, background: "var(--bg-nav)", border: "1px solid var(--border-nav)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className={ITEM_CLASS} style={{ color: "var(--text-primary)" }} onClick={() => onEditTags(entries)}>
        {t("library.editTags")}
      </button>
      {single && candidates && (
        <button
          className={ITEM_CLASS}
          style={{ color: "var(--color-progress-inprogress)" }}
          onClick={() => onResolveLocation(single, candidates)}
        >
          {t("library.resolveLocation")}
        </button>
      )}
      <button className={ITEM_CLASS} style={{ color: "var(--text-primary)" }} onClick={() => onResetProgress(entries)}>
        {t("library.resetProgress")}
      </button>
      <button className={ITEM_CLASS} style={{ color: "var(--text-primary)" }} onClick={() => onMarkAsRead(entries)}>
        {t("library.markAsRead")}
      </button>
      <button className={ITEM_CLASS} style={{ color: "var(--text-primary)" }} onClick={() => onMoveToFolder(entries)}>
        {t("library.moveToFolder")}
      </button>
      <button className={ITEM_CLASS} style={{ color: "var(--color-danger)" }} onClick={() => onDelete(entries)}>
        {t("library.delete")}
      </button>
    </div>
  );
}

export default ContextMenu;
