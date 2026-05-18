import { useTranslation } from "react-i18next";
import type { Theme } from "../utils/theme";

type NavView = "home" | "library";

function NavBar({
  view,
  onNavigate,
  theme,
  onToggleTheme,
  language,
  onSetLanguage,
}: {
  view: NavView;
  onNavigate: (v: NavView) => void;
  theme: Theme;
  onToggleTheme: () => void;
  language: string;
  onSetLanguage: (lang: string) => void;
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

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => onSetLanguage("es")}
            className="transition-colors"
            style={{ color: language === "es" ? "var(--text-primary)" : "var(--text-muted)", fontWeight: language === "es" ? 600 : 400 }}
          >
            ES
          </button>
          <span style={{ color: "var(--text-muted)" }}>|</span>
          <button
            onClick={() => onSetLanguage("en")}
            className="transition-colors"
            style={{ color: language === "en" ? "var(--text-primary)" : "var(--text-muted)", fontWeight: language === "en" ? 600 : 400 }}
          >
            EN
          </button>
        </div>

        <button
          onClick={onToggleTheme}
          title={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
          className="transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          {theme === "dark" ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7zm0-5a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 17a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zM4.22 4.22a1 1 0 0 1 1.42 0l.7.71a1 1 0 0 1-1.42 1.41l-.7-.7a1 1 0 0 1 0-1.42zm13.72 13.72a1 1 0 0 1 1.41 0l.71.7a1 1 0 1 1-1.41 1.42l-.71-.71a1 1 0 0 1 0-1.41zM3 11a1 1 0 0 1 0 2H2a1 1 0 1 1 0-2h1zm19 0a1 1 0 0 1 0 2h-1a1 1 0 1 1 0-2h1zM5.64 17.66a1 1 0 0 1 0 1.41l-.7.71a1 1 0 1 1-1.42-1.41l.71-.71a1 1 0 0 1 1.41 0zm13.72-13.72a1 1 0 0 1 0 1.42l-.71.7a1 1 0 0 1-1.41-1.41l.7-.71a1 1 0 0 1 1.42 0z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
            </svg>
          )}
        </button>
      </div>
    </nav>
  );
}

export default NavBar;
