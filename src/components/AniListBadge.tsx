import { useTranslation } from "react-i18next";

const BADGE_LABEL = "AL";

/** Marks an entry whose series folder is linked to AniList (tooltip = linked title). */
function AniListBadge({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <span
      className="shrink-0 px-1 rounded text-[9px] font-bold leading-4"
      style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
      title={t("anilist.linkedTo", { title })}
    >
      {BADGE_LABEL}
    </span>
  );
}

export default AniListBadge;
