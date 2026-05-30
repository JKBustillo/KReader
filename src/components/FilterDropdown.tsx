import { useEffect, useRef, useState, type ReactNode } from "react";

const DROPDOWN_MAX_HEIGHT = 280;

/**
 * Filter dropdown shell shared by the folders and tags filters: a trigger button
 * with a count badge, a search input, a scrollable item area, and a clear footer.
 * Owns its own open/search state and click-outside dismiss. Callers render the
 * item list via `renderItems(search)`.
 */
function FilterDropdown({
  label,
  selectedCount,
  searchPlaceholder,
  width,
  onClear,
  renderItems,
}: {
  label: string;
  selectedCount: number;
  searchPlaceholder: string;
  width: number;
  onClear: () => void;
  renderItems: (search: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{
          background: selectedCount > 0 ? "var(--color-selection)" : "var(--bg-tab-active)",
          color: selectedCount > 0 ? "#fff" : "var(--text-secondary)",
          border: "1px solid var(--border-nav)",
        }}
      >
        {label}{selectedCount > 0 ? ` (${selectedCount})` : ""}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded shadow-lg flex flex-col"
          style={{ width: `${width}px`, background: "var(--bg-nav)", border: "1px solid var(--border-nav)" }}
        >
          <div className="p-2 border-b shrink-0" style={{ borderColor: "var(--border-nav)" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full text-xs rounded px-2 py-1 outline-none"
              style={{
                background: "var(--bg-tab-active)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-nav)",
              }}
              autoFocus
            />
          </div>
          <div style={{ overflowY: "auto", maxHeight: `${DROPDOWN_MAX_HEIGHT}px` }}>
            {renderItems(search)}
          </div>
          {selectedCount > 0 && (
            <button
              onClick={onClear}
              className="px-3 py-1.5 text-xs border-t text-left transition-colors hover:bg-[var(--bg-tab-active)]"
              style={{ borderColor: "var(--border-nav)", color: "var(--text-muted)" }}
            >
              ✕ {label} ({selectedCount})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default FilterDropdown;
