import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryEntry } from "../types/library";

const ITEM_CLASS = "block w-full text-left px-4 py-2 text-sm hover:bg-[var(--glow-soft)] transition-colors";
// Destructive action: danger-colored text that flips to white on a danger fill.
// Color lives in the class (not inline) so the hover:text-white can win.
const DANGER_ITEM_CLASS = "block w-full text-left px-4 py-2 text-sm transition-colors text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white";

// Keep the menu this many px away from every viewport edge.
const VIEWPORT_MARGIN_PX = 8;

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

  // Clamp the menu inside the viewport once its real size is known. Flip to the
  // left/top of the cursor when it would overflow the right/bottom edge, then
  // clamp so it never leaves the viewport even after flipping.
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = x + width + VIEWPORT_MARGIN_PX > window.innerWidth ? x - width : x;
    let top = y + height + VIEWPORT_MARGIN_PX > window.innerHeight ? y - height : y;
    left = Math.max(VIEWPORT_MARGIN_PX, Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN_PX));
    top = Math.max(VIEWPORT_MARGIN_PX, Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN_PX));
    setPos({ top, left });
  }, [x, y]);

  const single = entries.length === 1 ? entries[0] : null;
  const candidates = single ? ambiguousCandidates.get(single.id) : undefined;

  return (
    <div
      ref={menuRef}
      className="kr-pop fixed z-50 rounded-xl shadow-2xl overflow-hidden py-1 min-w-[184px]"
      style={{ top: pos.top, left: pos.left, background: "var(--bg-nav)", border: "1px solid var(--border-nav)", transformOrigin: "top left" }}
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
      <div className="my-1 h-px" style={{ background: "var(--border-nav)" }} />
      <button className={DANGER_ITEM_CLASS} onClick={() => onDelete(entries)}>
        {t("library.delete")}
      </button>
    </div>
  );
}

export default ContextMenu;
