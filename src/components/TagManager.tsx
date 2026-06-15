import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryEntry } from "../types/library";
import Modal from "./Modal";
import ColorSwatch from "./ColorSwatch";

const LIST_MAX_HEIGHT_PX = 360;

type TagSummary = {
  value: string;
  count: number;
  color: string | undefined;
};

// Aggregate the distinct custom tags across the given entries with how many
// entries carry each one and a representative color (first colored occurrence).
function summarizeCustomTags(entries: LibraryEntry[]): TagSummary[] {
  const map = new Map<string, TagSummary>();
  for (const entry of entries) {
    for (const tag of entry.customTags) {
      const existing = map.get(tag.value);
      if (existing) {
        existing.count += 1;
        if (existing.color === undefined && tag.color) existing.color = tag.color;
      } else {
        map.set(tag.value, { value: tag.value, count: 1, color: tag.color });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.value.localeCompare(b.value));
}

function TagManager({
  entries,
  onRename,
  onRecolor,
  onDelete,
  onClose,
}: {
  entries: LibraryEntry[];
  onRename: (from: string, to: string) => void;
  onRecolor: (value: string, color: string | undefined) => void;
  onDelete: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tags = useMemo(() => summarizeCustomTags(entries), [entries]);

  // Which tag (by value) is currently being renamed, and the draft text.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Which tag (by value) has a pending delete confirmation.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const startEditing = (value: string) => {
    setPendingDelete(null);
    setEditing(value);
    setDraft(value);
  };

  const commitRename = (from: string) => {
    const to = draft.trim();
    if (to && to !== from) onRename(from, to);
    setEditing(null);
    setDraft("");
  };

  const cancelEditing = () => {
    setEditing(null);
    setDraft("");
  };

  return (
    <Modal onClose={onClose} panelClassName="max-w-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("library.manageTags")}
        </h2>
        <button
          onClick={onClose}
          className="text-lg leading-none opacity-60 hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      </div>

      {tags.length === 0 ? (
        <p className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>
          {t("library.noCustomTags")}
        </p>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: `${LIST_MAX_HEIGHT_PX}px` }}>
          {tags.map((tag) => {
            const isEditing = editing === tag.value;
            const isPendingDelete = pendingDelete === tag.value;
            return (
              <div
                key={tag.value}
                className="flex items-center gap-2 px-2 py-1.5 rounded"
                style={{ background: "var(--bg-tab-active)" }}
              >
                <ColorSwatch color={tag.color} onChange={(c) => onRecolor(tag.value, c)} />

                {isEditing ? (
                  <input
                    type="text"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(tag.value); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelEditing(); }
                    }}
                    className="flex-1 min-w-0 text-sm rounded px-2 py-0.5 outline-none"
                    style={{
                      background: "var(--bg-nav)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-nav)",
                    }}
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate text-sm" style={{ color: "var(--text-primary)" }}>
                    {tag.value}
                  </span>
                )}

                {isPendingDelete ? (
                  <>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("library.deleteTagConfirm", { count: tag.count })}
                    </span>
                    <button
                      type="button"
                      onClick={() => { onDelete(tag.value); setPendingDelete(null); }}
                      className="text-sm px-1 leading-none"
                      style={{ color: "var(--color-danger)" }}
                      title={t("library.deleteTag")}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(null)}
                      className="text-sm px-1 leading-none opacity-60 hover:opacity-100"
                      style={{ color: "var(--text-muted)" }}
                    >
                      ✕
                    </button>
                  </>
                ) : isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => commitRename(tag.value)}
                      className="text-sm px-1 leading-none"
                      style={{ color: "var(--accent)" }}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="text-sm px-1 leading-none opacity-60 hover:opacity-100"
                      style={{ color: "var(--text-muted)" }}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                      {tag.count}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEditing(tag.value)}
                      className="text-xs px-1 opacity-70 hover:opacity-100"
                      style={{ color: "var(--text-secondary)" }}
                      title={t("library.renameTag")}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditing(null); setPendingDelete(tag.value); }}
                      className="text-sm px-1 leading-none opacity-70 hover:opacity-100"
                      style={{ color: "var(--color-danger)" }}
                      title={t("library.deleteTag")}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export default TagManager;
