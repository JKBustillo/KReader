import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchManga, type MediaSearchResult } from "../utils/anilistApi";
import type { SeriesLink } from "../utils/anilistStore";
import Modal from "./Modal";
import Button from "./Button";

const SEARCH_DEBOUNCE_MS = 400;

/**
 * Links a series folder to an AniList media: searches AniList with the folder
 * name pre-filled and saves the pick. Also unlinks when a link already exists.
 */
function AniListLinkModal({
  folderName,
  currentLink,
  onSave,
  onClose,
}: {
  folderName: string;
  currentLink: SeriesLink | undefined;
  onSave: (link: SeriesLink | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(folderName);
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const search = query.trim();
    if (!search) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      setError(false);
      searchManga(search)
        .then((media) => { if (!cancelled) setResults(media); })
        .catch((err) => {
          console.error("[anilist search]", err);
          if (!cancelled) setError(true);
        })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handlePick = (media: MediaSearchResult) => {
    onSave({
      mediaId: media.id,
      title: media.title,
      coverUrl: media.coverUrl,
      chapters: media.chapters,
      volumes: media.volumes,
    });
  };

  return (
    <Modal onClose={onClose} panelClassName="max-w-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("anilist.linkTitle", { folder: folderName })}
        </h2>
        <button
          onClick={onClose}
          className="text-lg leading-none opacity-60 hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      </div>

      {currentLink && (
        <div className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <span className="truncate">{t("anilist.linkedTo", { title: currentLink.title })}</span>
          <Button variant="danger" size="sm" onClick={() => onSave(undefined)}>
            {t("anilist.unlink")}
          </Button>
        </div>
      )}

      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("anilist.searchPlaceholder")}
        className="w-full px-3 py-2 text-sm rounded outline-none"
        style={{ background: "var(--bg-tab-active)", color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
      />

      <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
        {searching && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("anilist.searching")}</p>
        )}
        {!searching && error && (
          <p className="text-xs" style={{ color: "var(--color-danger)" }}>{t("anilist.searchError")}</p>
        )}
        {!searching && !error && results.length === 0 && query.trim() && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("anilist.noResults")}</p>
        )}
        {results.map((media) => {
          const isCurrent = media.id === currentLink?.mediaId;
          const details = [
            media.format,
            media.year,
            media.volumes !== null ? t("anilist.volumesCount", { count: media.volumes }) : null,
            media.chapters !== null ? t("anilist.chaptersCount", { count: media.chapters }) : null,
          ].filter((d) => d !== null && d !== undefined);
          return (
            <button
              key={media.id}
              onClick={() => handlePick(media)}
              className="flex items-center gap-3 text-left px-2 py-1.5 rounded transition-colors hover:bg-[var(--bg-tab-active)]"
              style={{ border: `1px solid ${isCurrent ? "var(--accent)" : "var(--border-nav)"}` }}
            >
              {media.coverUrl ? (
                <img src={media.coverUrl} alt="" className="w-10 h-14 object-cover rounded shrink-0" />
              ) : (
                <div className="w-10 h-14 rounded shrink-0" style={{ background: "var(--bg-tab-active)" }} />
              )}
              <div className="flex flex-col min-w-0">
                <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>{media.title}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{details.join(" · ")}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export default AniListLinkModal;
