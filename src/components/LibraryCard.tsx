import { useEffect, useRef, useState } from "react";
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

function LibraryCard({
  entry,
  notFound,
  onOpen,
}: {
  entry: LibraryEntry;
  notFound: boolean;
  onOpen: (entry: LibraryEntry) => void;
}) {
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
      onDoubleClick={() => !notFound && onOpen(entry)}
      className="flex flex-col rounded-lg overflow-hidden cursor-pointer select-none hover:brightness-[1.08]"
      style={{
        background: "var(--bg-tab-active)",
        opacity: notFound ? 0.4 : 1,
        border: "1px solid var(--border-nav)",
        contentVisibility: "auto",
        containIntrinsicSize: CARD_INTRINSIC_SIZE,
      }}
      title={notFound ? entry.currentPath : title}
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
