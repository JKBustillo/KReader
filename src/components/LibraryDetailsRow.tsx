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

// Column widths kept as constants so header and rows stay aligned.
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
}: {
  entry: LibraryEntry;
  rootPath: string;
  notFound: boolean;
  onOpen: (entry: LibraryEntry) => void;
}) {
  const name = entry.filename.replace(/\.[^.]+$/, "");
  const folder = getRelativeFolder(entry.currentPath, rootPath);

  return (
    <div
      onDoubleClick={() => !notFound && onOpen(entry)}
      className="flex items-center gap-4 px-4 py-2 text-sm border-b cursor-pointer select-none hover:bg-[var(--bg-tab-active)] transition-colors"
      style={{ borderColor: "var(--border-nav)", opacity: notFound ? 0.45 : 1 }}
      title={notFound ? entry.currentPath : undefined}
    >
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

export { COL_WIDTHS, LibraryDetailsRow };
