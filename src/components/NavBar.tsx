import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

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

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm transition-colors ${
      active ? "font-medium" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    }`;
  const tabStyle = (active: boolean) =>
    active ? { background: "var(--accent)", color: "var(--accent-ink)" } : undefined;

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-11 border-b"
      style={{ background: "var(--bg-nav)", borderColor: "var(--border-nav)" }}
    >
      <div className="flex items-center">
        {/* Brand mark */}
        <div className="flex items-center gap-2 mr-4 select-none">
          <span
            className="w-[7px] h-[7px] rounded-full"
            style={{ background: "var(--accent)", boxShadow: "0 0 10px var(--glow)" }}
          />
          <span className="font-display text-[15px] font-semibold tracking-tight">KReader</span>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => onNavigate("home")} className={tabClass(view === "home")} style={tabStyle(view === "home")}>
            {t("nav.home")}
          </button>
          <button onClick={() => onNavigate("library")} className={tabClass(view === "library")} style={tabStyle(view === "library")}>
            {t("nav.library")}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => { invoke("open_new_window").catch(console.error); }}
          title={t("nav.newWindow")}
          className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </button>

        <button
          onClick={onOpenSettings}
          title={t("settings.title")}
          className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

export default NavBar;
