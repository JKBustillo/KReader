import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryEntry } from "../types/library";
import { getThumbnail } from "../utils/thumbnails";
import { computeProgress, PROGRESS_DOT_COLORS } from "../utils/progress";

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

const RATING_COUNT = 5;

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
            style={{ fontSize: "14px", lineHeight: 1, color: filled ? "var(--color-favorite)" : "var(--text-muted)" }}
          >
            {filled ? "★" : "☆"}
          </button>
        );
      })}
    </div>
  );
}

function LibraryCard({
  entry,
  notFound,
  ambiguous,
  selected,
  onOpen,
  onSelect,
  onToggleFavorite,
  onRate,
  onContextMenu,
  showProgressBar,
  currentPage,
  showPageCount,
}: {
  entry: LibraryEntry;
  notFound: boolean;
  ambiguous: boolean;
  selected: boolean;
  onOpen: (entry: LibraryEntry) => void;
  onSelect: (entry: LibraryEntry, e: MouseEvent<HTMLDivElement>) => void;
  onToggleFavorite: (entry: LibraryEntry) => void;
  onRate: (entry: LibraryEntry, rating: number | undefined) => void;
  onContextMenu: (entry: LibraryEntry, x: number, y: number) => void;
  showProgressBar: boolean;
  currentPage: number;
  showPageCount: boolean;
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
      className="group flex flex-col cursor-pointer select-none transition-transform duration-200 hover:-translate-y-1"
      style={{
        opacity: notFound && !ambiguous ? 0.4 : 1,
        contentVisibility: "auto",
        containIntrinsicSize: CARD_INTRINSIC_SIZE,
      }}
      title={ambiguous ? t("library.ambiguous") : notFound ? entry.currentPath : title}
    >
      {/* Cover area — 2:3 portrait ratio */}
      <div
        className="kr-card-cover relative w-full rounded-xl overflow-hidden"
        data-ring={selected ? "selected" : ambiguous ? "ambiguous" : undefined}
        style={{ aspectRatio: "2/3", background: "var(--bg-nav)" }}
      >
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

        {/* Bottom gradient for title legibility over the cover art */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 4%, transparent 46%)" }}
        />

        {/* Status — top-left: ambiguous badge then reading dot (avoids the title) */}
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
          {ambiguous && (
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: "var(--color-progress-inprogress)", color: "#fff" }}
            >
              ?
            </span>
          )}
          {entry.readingState !== "unread" && (
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: PROGRESS_DOT_COLORS[entry.readingState], boxShadow: "0 0 8px currentColor", color: PROGRESS_DOT_COLORS[entry.readingState] }}
            />
          )}
        </div>

        {/* Favorite toggle — always visible, top-right of cover */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(entry); }}
          className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full"
          style={{
            color: entry.isFavorite ? "var(--color-favorite)" : "rgba(255,255,255,0.7)",
            background: "rgba(0,0,0,0.4)",
          }}
          title={entry.isFavorite ? t("library.removeFromFavorites") : t("library.addToFavorites")}
        >
          <StarIcon filled={entry.isFavorite} />
        </button>

        {/* Title — overlaid on the cover */}
        <p
          className="absolute left-2.5 right-2.5 bottom-2.5 z-10 font-display text-sm font-semibold leading-tight line-clamp-2 break-words"
          style={{ color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,0.65)" }}
        >
          {title}
        </p>
      </div>

      {/* Rating + page count + progress */}
      <div className="px-0.5 pt-2.5 flex flex-col gap-1.5">
        <RatingStars rating={entry.rating} onRate={(r) => onRate(entry, r)} />
        {showPageCount && (entry.totalPages ?? 0) > 0 && (
          <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {entry.totalPages} {t("library.pages")}
          </span>
        )}
        {showProgressBar && (entry.totalPages ?? 0) > 0 && entry.readingState !== "unread" && (() => {
          const progressPct = computeProgress(entry, currentPage);
          const progressColor = PROGRESS_DOT_COLORS[entry.readingState === "completed" ? "completed" : "in_progress"];
          return (
            <div
              className="w-full h-1 rounded-full overflow-hidden"
              style={{ background: "var(--border-nav)" }}
              title={`${progressPct}%`}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${progressPct}%`, background: progressColor, boxShadow: `0 0 8px ${progressColor}` }}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default LibraryCard;
