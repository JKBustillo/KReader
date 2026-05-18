import { useTranslation } from "react-i18next";
import type { LibraryEntry, SortField } from "../types/library";

const BYTES_IN_MB = 1_048_576;
const BYTES_IN_KB = 1_024;

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

function getRelativeFolder(entryPath: string, rootPath: string): string {
  const normalized = entryPath.replace(/\\/g, "/");
  const normalizedRoot = rootPath.replace(/\\/g, "/");
  const dir = normalized.substring(0, normalized.lastIndexOf("/"));
  if (dir === normalizedRoot) return "/";
  const rel = dir.startsWith(normalizedRoot + "/")
    ? dir.slice(normalizedRoot.length + 1)
    : dir;
  return rel || "/";
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

// Column widths kept as constants so header and rows stay aligned.
const COL_STAR = "w-6 shrink-0 flex items-center justify-center";
const COL_WIDTHS: Record<SortField, string> = {
  name:   "flex-1 min-w-0",
  size:   "w-24 shrink-0 text-right",
  date:   "w-32 shrink-0",
  folder: "w-48 shrink-0 min-w-0",
};

function LibraryDetailsRow({
  entry,
  rootPath,
  notFound,
  onOpen,
  onToggleFavorite,
}: {
  entry: LibraryEntry;
  rootPath: string;
  notFound: boolean;
  onOpen: (entry: LibraryEntry) => void;
  onToggleFavorite: (entry: LibraryEntry) => void;
}) {
  const { t } = useTranslation();
  const name = entry.filename.replace(/\.[^.]+$/, "");
  const folder = getRelativeFolder(entry.currentPath, rootPath);

  return (
    <div
      onDoubleClick={() => !notFound && onOpen(entry)}
      className="flex items-center gap-4 px-4 py-2 text-sm border-b cursor-pointer select-none hover:bg-[var(--bg-tab-active)] transition-colors"
      style={{ borderColor: "var(--border-nav)", opacity: notFound ? 0.45 : 1 }}
      title={notFound ? entry.currentPath : undefined}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(entry); }}
        className={COL_STAR}
        style={{ color: entry.isFavorite ? "var(--color-favorite)" : "var(--text-muted)" }}
        title={entry.isFavorite ? t("library.removeFromFavorites") : t("library.addToFavorites")}
      >
        <StarIcon filled={entry.isFavorite} />
      </button>
      <span className={`${COL_WIDTHS.name} truncate`} style={{ color: "var(--text-primary)" }}>
        {name}
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

export { COL_STAR, COL_WIDTHS, LibraryDetailsRow };
