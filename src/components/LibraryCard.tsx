import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryEntry } from "../types/library";
import { getThumbnail } from "../utils/thumbnails";

const THUMBNAIL_MARGIN = "1000px";
const CARD_INTRINSIC_SIZE = "0 250px";

function FileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: "var(--text-muted)" }}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
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

const PROGRESS_DOT_COLORS: Record<"in_progress" | "completed", string> = {
  in_progress: "var(--color-progress-inprogress)",
  completed:   "var(--color-progress-complete)",
};

function LibraryCard({
  entry,
  notFound,
  ambiguous,
  selected,
  onOpen,
  onSelect,
  onToggleFavorite,
  onContextMenu,
}: {
  entry: LibraryEntry;
  notFound: boolean;
  ambiguous: boolean;
  selected: boolean;
  onOpen: (entry: LibraryEntry) => void;
  onSelect: (entry: LibraryEntry, e: MouseEvent<HTMLDivElement>) => void;
  onToggleFavorite: (entry: LibraryEntry) => void;
  onContextMenu: (entry: LibraryEntry, x: number, y: number) => void;
}) {
  const { t } = useTranslation();
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        getThumbnail(entry).then((url) => {
          if (!cancelled) {
            setThumbnail(url);
            setThumbLoading(false);
          }
        });
      },
      { rootMargin: THUMBNAIL_MARGIN },
    );
    if (cardRef.current) observer.observe(cardRef.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const title = entry.filename.replace(/\.[^.]+$/, "");

  return (
    <div
      ref={cardRef}
      onClick={(e) => { if (e.detail < 2) onSelect(entry, e); }}
      onDoubleClick={() => !notFound && onOpen(entry)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(entry, e.clientX, e.clientY); }}
      className="flex flex-col rounded-lg overflow-hidden cursor-pointer select-none hover:brightness-[1.08]"
      style={{
        background: "var(--bg-tab-active)",
        opacity: notFound && !ambiguous ? 0.4 : 1,
        border: selected
          ? "2px solid var(--color-selection)"
          : ambiguous
            ? "2px solid var(--color-progress-inprogress)"
            : "1px solid var(--border-nav)",
        contentVisibility: "auto",
        containIntrinsicSize: CARD_INTRINSIC_SIZE,
      }}
      title={ambiguous ? t("library.ambiguous") : notFound ? entry.currentPath : title}
    >
      {/* Cover area — 2:3 portrait ratio */}
      <div className="relative w-full" style={{ aspectRatio: "2/3", background: "var(--bg-nav)" }}>
        {thumbLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }}
            />
          </div>
        ) : thumbnail ? (
          <img
            src={thumbnail}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <FileIcon />
          </div>
        )}

        {/* Ambiguous badge — top-left of cover */}
        {ambiguous && (
          <span
            className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ background: "var(--color-progress-inprogress)", color: "#fff" }}
          >
            ?
          </span>
        )}

        {/* Reading progress dot — bottom-left of cover */}
        {entry.readingState !== "unread" && (
          <span
            className="absolute bottom-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full"
            style={{ background: PROGRESS_DOT_COLORS[entry.readingState] }}
          />
        )}

        {/* Favorite toggle — always visible, top-right of cover */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(entry); }}
          className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full"
          style={{
            color: entry.isFavorite ? "var(--color-favorite)" : "var(--text-muted)",
            background: "rgba(0,0,0,0.35)",
          }}
          title={entry.isFavorite ? t("library.removeFromFavorites") : t("library.addToFavorites")}
        >
          <StarIcon filled={entry.isFavorite} />
        </button>
      </div>

      {/* Title */}
      <div className="px-2 py-1.5">
        <p className="text-xs leading-snug line-clamp-2 break-words"
          style={{ color: "var(--text-secondary)" }}>
          {title}
        </p>
      </div>
    </div>
  );
}

export default LibraryCard;
