import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryEntry, SortField } from "../types/library";
import { getRelativeFolder } from "../utils/folderUtils";

const BYTES_IN_MB = 1_048_576;
const BYTES_IN_KB = 1_024;
const RATING_COUNT = 5;

function formatSize(bytes: number): string {
  if (bytes >= BYTES_IN_MB) return `${(bytes / BYTES_IN_MB).toFixed(1)} MB`;
  if (bytes >= BYTES_IN_KB) return `${Math.round(bytes / BYTES_IN_KB)} KB`;
  return `${bytes} B`;
}

function formatDate(secs: number): string {
  if (!secs) return "—";
  return new Date(secs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function RatingStars({ rating, onRate }: { rating: number | undefined; onRate: (r: number | undefined) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: RATING_COUNT }, (_, i) => {
        const star = i + 1;
        const filled = star <= (rating ?? 0);
        return (
          <button
            key={star}
            onClick={(e) => { e.stopPropagation(); onRate(rating === star ? undefined : star); }}
            style={{ fontSize: "15px", lineHeight: 1, color: filled ? "var(--color-favorite)" : "var(--text-muted)" }}
          >
            {filled ? "★" : "☆"}
          </button>
        );
      })}
    </div>
  );
}

// Column widths kept as constants so header and rows stay aligned.
const COL_STAR = "w-6 shrink-0 flex items-center justify-center";
const COL_RATING = "w-24 shrink-0";
const COL_WIDTHS: Record<SortField, string> = {
  name:      "flex-1 min-w-0",
  size:      "w-24 shrink-0 text-right",
  date:      "w-32 shrink-0",
  folder:    "w-48 shrink-0 min-w-0",
  lastOpened:"w-32 shrink-0",
};

const PROGRESS_DOT_COLORS: Record<"in_progress" | "completed", string> = {
  in_progress: "var(--color-progress-inprogress)",
  completed:   "var(--color-progress-complete)",
};

function LibraryDetailsRow({
  entry,
  rootPath,
  notFound,
  ambiguous,
  selected,
  onOpen,
  onSelect,
  onToggleFavorite,
  onRate,
  onContextMenu,
}: {
  entry: LibraryEntry;
  rootPath: string;
  notFound: boolean;
  ambiguous: boolean;
  selected: boolean;
  onOpen: (entry: LibraryEntry) => void;
  onSelect: (entry: LibraryEntry, e: MouseEvent<HTMLDivElement>) => void;
  onToggleFavorite: (entry: LibraryEntry) => void;
  onRate: (entry: LibraryEntry, rating: number | undefined) => void;
  onContextMenu: (entry: LibraryEntry, x: number, y: number) => void;
}) {
  const { t } = useTranslation();
  const name = entry.filename.replace(/\.[^.]+$/, "");
  const folder = getRelativeFolder(entry.currentPath, rootPath);

  return (
    <div
      onClick={(e) => { if (e.detail < 2) onSelect(entry, e); }}
      onDoubleClick={() => !notFound && onOpen(entry)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(entry, e.clientX, e.clientY); }}
      className="flex items-center gap-4 px-4 py-2 text-sm border-b cursor-pointer select-none transition-colors"
      style={{
        borderColor: "var(--border-nav)",
        opacity: notFound && !ambiguous ? 0.45 : 1,
        background: selected ? "var(--color-selection-bg)" : undefined,
        borderLeft: ambiguous ? "3px solid var(--color-progress-inprogress)" : undefined,
      }}
      title={ambiguous ? t("library.ambiguous") : notFound ? entry.currentPath : undefined}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(entry); }}
        className={COL_STAR}
        style={{ color: entry.isFavorite ? "var(--color-favorite)" : "var(--text-muted)" }}
        title={entry.isFavorite ? t("library.removeFromFavorites") : t("library.addToFavorites")}
      >
        <StarIcon filled={entry.isFavorite} />
      </button>
      <div className={COL_RATING}>
        <RatingStars rating={entry.rating} onRate={(r) => onRate(entry, r)} />
      </div>
      <span className={`${COL_WIDTHS.name} flex items-center gap-1.5 min-w-0`} style={{ color: "var(--text-primary)" }}>
        {ambiguous && (
          <span
            className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{ background: "var(--color-progress-inprogress)", color: "#fff" }}
          >
            ?
          </span>
        )}
        {entry.readingState !== "unread" && (
          <span
            className="shrink-0 w-2 h-2 rounded-full"
            style={{ background: PROGRESS_DOT_COLORS[entry.readingState] }}
          />
        )}
        <span className="truncate">{name}</span>
      </span>
      <span className={`${COL_WIDTHS.size} tabular-nums`} style={{ color: "var(--text-secondary)" }}>
        {formatSize(entry.sizeBytes)}
      </span>
      <span className={COL_WIDTHS.date} style={{ color: "var(--text-secondary)" }}>
        {formatDate(entry.modifiedAt)}
      </span>
      <span className={`${COL_WIDTHS.folder} truncate`} style={{ color: "var(--text-muted)" }}>
        {folder}
      </span>
    </div>
  );
}

export { COL_STAR, COL_RATING, COL_WIDTHS, LibraryDetailsRow };
