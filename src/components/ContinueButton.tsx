import { useTranslation } from "react-i18next";
import type { LibraryEntry } from "../types/library";
import type { ContinueTarget } from "../utils/continueReading";

const withoutExtension = (filename: string) => filename.replace(/\.[^.]+$/, "");

/**
 * "Continue <file> (page/total)" / "Start <file>" for a pickContinueTarget result; disabled
 * "Up to date" when there's nothing left. Used in the library toolbar and the AniList sidebar.
 */
function ContinueButton({
  target,
  currentPage,
  onOpen,
  shortcut,
  className = "",
}: {
  target: ContinueTarget | null;
  /** Saved 0-based page of the target, if known. */
  currentPage?: number;
  onOpen: (entry: LibraryEntry) => void;
  /** Key shown in the tooltip when one triggers the same action. */
  shortcut?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const entry = target?.entry;
  const totalPages = entry?.totalPages ?? 0;
  const showPage = target?.mode === "continue" && currentPage !== undefined && currentPage > 0 && totalPages > 0;
  const title = entry
    ? shortcut ? `${entry.filename} (${shortcut})` : entry.filename
    : undefined;

  return (
    <button
      onClick={() => { if (entry) onOpen(entry); }}
      disabled={!entry}
      title={title}
      className={`flex items-center gap-1.5 min-w-0 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors enabled:hover:border-[var(--accent)] disabled:opacity-60 ${className}`}
      style={{
        background: "var(--bg-tab-active)",
        color: entry ? "var(--text-primary)" : "var(--text-muted)",
        border: "1px solid var(--border-nav)",
      }}
    >
      {entry && (
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
          fill="currentColor" aria-hidden="true" className="shrink-0" style={{ color: "var(--accent)" }}>
          <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
      )}
      {target ? (
        <>
          <span className="shrink-0">{t(target.mode === "continue" ? "library.continueReading" : "library.startReading")}</span>
          <span className="truncate" style={{ color: "var(--text-secondary)" }}>· {withoutExtension(target.entry.filename)}</span>
          {showPage && (
            <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
              ({currentPage + 1}/{totalPages})
            </span>
          )}
        </>
      ) : (
        <span>{t("library.upToDate")}</span>
      )}
    </button>
  );
}

export default ContinueButton;
