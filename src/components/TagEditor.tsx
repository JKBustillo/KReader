import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryEntry, Tag } from "../types/library";
import ColorSwatch from "./ColorSwatch";

const MAX_SUGGESTIONS = 5;

function TagChip({
  tag,
  onRemove,
  onColorChange,
}: {
  tag: Tag;
  onRemove: () => void;
  onColorChange: (color: string | undefined) => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
      style={{
        background: "var(--bg-tab-active)",
        border: "1px solid var(--border-nav)",
        color: tag.color ?? "var(--text-primary)",
      }}
    >
      <ColorSwatch color={tag.color} onChange={onColorChange} />
      {tag.value}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 opacity-60 hover:opacity-100"
        style={{ color: "var(--text-muted)" }}
      >
        ×
      </button>
    </span>
  );
}

function AutoTagChip({ tag }: { tag: Tag }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
      style={{
        background: "transparent",
        border: "1px solid var(--border-nav)",
        color: "var(--text-muted)",
      }}
    >
      {tag.value}
    </span>
  );
}

function TagEditor({
  entries,
  onSave,
  onClose,
  allTagValues,
  recentTags,
  onRecordRecent,
}: {
  entries: LibraryEntry[];
  onSave: (updates: { id: string; tags: Tag[] }[]) => void;
  onClose: () => void;
  allTagValues?: string[];
  // Recently-assigned custom tag values (most recent first), shown as a
  // quick-pick list when the input is focused but empty.
  recentTags?: string[];
  // Reports the curated tag values on save so they can be remembered as recent.
  onRecordRecent?: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const isMulti = entries.length > 1;

  const computeInitialTags = (): Tag[] => {
    if (!isMulti) return entries[0].customTags.map((t) => ({ ...t }));
    const first = entries[0].customTags.map((t) => t.value);
    const common = first.filter((v) =>
      entries.every((e) => e.customTags.some((t) => t.value === v))
    );
    return common.map((v) => {
      const found = entries[0].customTags.find((t) => t.value === v)!;
      return { ...found };
    });
  };

  const [customTags, setCustomTags] = useState<Tag[]>(computeInitialTags);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Register the Escape listener once on mount, reading the latest onClose via a
  // ref. With [onClose] (a new inline fn each parent render) the listener would
  // re-subscribe on LibraryView's frequent re-renders and drop the Escape event.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Intentionally no autofocus: focusing the input opens the recent-tags
  // quick-pick, which would otherwise cover the modal's actions on open. The
  // user focuses the input themselves to summon it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const trimmed = input.trim();
  const querySuggestions = trimmed.length > 0 && allTagValues
    ? allTagValues
        .filter(
          (v) =>
            v.toLowerCase().includes(trimmed.toLowerCase()) &&
            !customTags.some((t) => t.value === v),
        )
        .slice(0, MAX_SUGGESTIONS)
    : [];

  // With an empty, focused input, surface recently-assigned tags so the user can
  // re-apply a common tag without retyping it (excludes already-added ones).
  const recentSuggestions = trimmed.length === 0 && focused && recentTags
    ? recentTags
        .filter((v) => !customTags.some((t) => t.value === v))
        .slice(0, MAX_SUGGESTIONS)
    : [];

  const showingRecent = trimmed.length === 0 && recentSuggestions.length > 0;
  const suggestions = trimmed.length > 0 ? querySuggestions : recentSuggestions;

  const addTag = (value?: string) => {
    const val = (value ?? input).trim();
    if (!val || customTags.some((t) => t.value === val)) return;
    setCustomTags((prev) => [...prev, { type: "custom", value: val }]);
    setInput("");
  };

  const removeTag = (index: number) => {
    setCustomTags((prev) => prev.filter((_, i) => i !== index));
  };

  const updateColor = (index: number, color: string | undefined) => {
    setCustomTags((prev) =>
      prev.map((t, i) => (i === index ? { ...t, color } : t))
    );
  };

  const handleSave = () => {
    if (!isMulti) {
      onSave([{ id: entries[0].id, tags: customTags }]);
    } else {
      const initialTagValues = computeInitialTags().map((t) => t.value);
      const removedValues = initialTagValues.filter(
        (v) => !customTags.some((ct) => ct.value === v),
      );
      const addedTags = customTags.filter(
        (ct) => !initialTagValues.includes(ct.value),
      );

      const updates = entries.map((entry) => ({
        id: entry.id,
        tags: [
          ...entry.customTags.filter((t) => !removedValues.includes(t.value)),
          ...addedTags.filter((at) => !entry.customTags.some((t) => t.value === at.value)),
        ],
      }));

      onSave(updates);
    }
    onRecordRecent?.(customTags.map((t) => t.value));
    onClose();
  };

  const autoTags = isMulti ? [] : entries[0].autoTags;

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
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {isMulti
              ? t("library.editingFiles", { count: entries.length })
              : t("library.editTags")}
          </h2>
          <button
            onClick={onClose}
            className="text-lg leading-none opacity-60 hover:opacity-100"
            style={{ color: "var(--text-muted)" }}
          >
            ×
          </button>
        </div>

        {/* Auto tags — single mode only */}
        {!isMulti && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              {t("library.autoTagsLabel")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {autoTags.length === 0
                ? <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("library.noTags")}</span>
                : autoTags.map((tag, i) => <AutoTagChip key={i} tag={tag} />)
              }
            </div>
          </div>
        )}

        {/* Custom tags */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            {t("library.customTagsLabel")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {customTags.length === 0 && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("library.noTags")}</span>
            )}
            {customTags.map((tag, i) => (
              <TagChip
                key={i}
                tag={tag}
                onRemove={() => removeTag(i)}
                onColorChange={(c) => updateColor(i, c)}
              />
            ))}
          </div>
        </div>

        {/* Input + autocomplete */}
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder={t("library.addTag")}
                className="w-full text-sm rounded px-3 py-1.5 outline-none"
                style={{
                  background: "var(--bg-tab-active)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-nav)",
                }}
              />
              {suggestions.length > 0 && (
                <div
                  className="absolute left-0 right-0 top-full mt-0.5 z-50 rounded shadow-lg overflow-hidden"
                  style={{
                    background: "var(--bg-nav)",
                    border: "1px solid var(--border-nav)",
                  }}
                >
                  {showingRecent && (
                    <div
                      className="px-3 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {t("library.recentTags")}
                    </div>
                  )}
                  {suggestions.map((val) => (
                    <button
                      key={val}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); addTag(val); }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-tab-active)] transition-colors"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => addTag()}
              className="text-sm px-3 py-1.5 rounded"
              style={{
                background: "var(--bg-tab-active)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-nav)",
              }}
            >
              +
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("errors.goBack")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="text-sm px-4 py-1.5 rounded"
            style={{
              background: "var(--bg-tab-active)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-nav)",
            }}
          >
            ✓
          </button>
        </div>
      </div>
    </div>
  );
}

export default TagEditor;
