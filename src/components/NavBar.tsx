import { useTranslation } from "react-i18next";

type NavView = "home" | "library";

function NavBar({
  view,
  onNavigate,
  onOpenSettings,
}: {
  view: NavView;
  onNavigate: (v: NavView) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-11 border-b"
      style={{ background: "var(--bg-nav)", borderColor: "var(--border-nav)" }}
    >
      <div className="flex items-center gap-1">
        <button
          onClick={() => onNavigate("home")}
          className="px-3 py-1.5 rounded text-sm transition-colors"
          style={
            view === "home"
              ? { background: "var(--bg-tab-active)", color: "var(--text-primary)", fontWeight: 500 }
              : { color: "var(--text-muted)" }
          }
        >
          {t("nav.home")}
        </button>
        <button
          onClick={() => onNavigate("library")}
          className="px-3 py-1.5 rounded text-sm transition-colors"
          style={
            view === "library"
              ? { background: "var(--bg-tab-active)", color: "var(--text-primary)", fontWeight: 500 }
              : { color: "var(--text-muted)" }
          }
        >
          {t("nav.library")}
        </button>
      </div>

      <button
        onClick={onOpenSettings}
        title={t("settings.title")}
        className="transition-colors"
        style={{ color: "var(--text-muted)" }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </nav>
  );
}

export default NavBar;
