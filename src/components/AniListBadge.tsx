import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

const BADGE_LABEL = "AL";

/**
 * Marks an entry whose series folder is linked to AniList (tooltip = linked
 * title). Clicking it opens the series panel without selecting or opening the entry.
 */
function AniListBadge({ title, onClick }: { title: string; onClick: () => void }) {
  const { t } = useTranslation();
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <button
      type="button"
      className="shrink-0 px-1 rounded text-[9px] font-bold leading-4 hover:brightness-110"
      style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
      title={t("anilist.linkedTo", { title })}
      onClick={(e) => { stop(e); onClick(); }}
      onDoubleClick={stop}
    >
      {BADGE_LABEL}
    </button>
  );
}

export default AniListBadge;
