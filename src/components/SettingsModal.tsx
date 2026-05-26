import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { exportLibraryData, importLibraryData } from "../utils/libraryStore";
import type { Theme } from "../utils/theme";

function SettingsModal({
  open: isOpen,
  onClose,
  theme,
  onToggleTheme,
  language,
  onSetLanguage,
  showProgressBar,
  onToggleProgressBar,
  showPageCount,
  onTogglePageCount,
  onRefreshMetadata,
}: {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  language: string;
  onSetLanguage: (lang: string) => void;
  showProgressBar: boolean;
  onToggleProgressBar: () => void;
  showPageCount: boolean;
  onTogglePageCount: () => void;
  onRefreshMetadata: () => void;
}) {
  const { t } = useTranslation();
  const [importPending, setImportPending] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleExport = async () => {
    try {
      const data = await exportLibraryData();
      const json = JSON.stringify(data, null, 2);
      const path = await save({
        defaultPath: "kreader-backup.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, json);
    } catch (err) {
      console.error("[export]", err);
    }
  };

  const handleImportConfirm = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) { setImportPending(false); return; }
      const json = await readTextFile(path as string);
      const data = JSON.parse(json);
      await importLibraryData(data);
    } catch (err) {
      console.error("[import]", err);
    }
    setImportPending(false);
  };

  const chipActive = { background: "var(--bg-tab-active)", color: "var(--text-primary)" };
  const chipInactive = { background: "transparent", color: "var(--text-muted)" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="max-w-sm w-full rounded-lg p-5 flex flex-col gap-5"
        style={{ background: "var(--bg-nav)", border: "1px solid var(--border-nav)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("settings.title")}
          </h2>
          <button
            onClick={onClose}
            className="text-lg leading-none opacity-60 hover:opacity-100"
            style={{ color: "var(--text-muted)" }}
          >
            ×
          </button>
        </div>

        {/* Appearance */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {t("settings.appearance")}
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 py-1.5 text-xs rounded transition-colors"
              style={theme === "dark" ? chipActive : chipInactive}
              onClick={() => { if (theme !== "dark") onToggleTheme(); }}
            >
              {t("settings.themeDark")}
            </button>
            <button
              className="flex-1 py-1.5 text-xs rounded transition-colors"
              style={theme === "light" ? chipActive : chipInactive}
              onClick={() => { if (theme !== "light") onToggleTheme(); }}
            >
              {t("settings.themeLight")}
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {t("settings.language")}
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 py-1.5 text-xs rounded transition-colors"
              style={language === "es" ? chipActive : chipInactive}
              onClick={() => onSetLanguage("es")}
            >
              ES
            </button>
            <button
              className="flex-1 py-1.5 text-xs rounded transition-colors"
              style={language === "en" ? chipActive : chipInactive}
              onClick={() => onSetLanguage("en")}
            >
              EN
            </button>
          </div>
        </div>

        {/* Library */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {t("settings.library")}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--text-primary)" }}>
              {t("settings.progressBar")}
            </span>
            <button
              onClick={onToggleProgressBar}
              className="w-9 h-5 rounded-full relative transition-colors"
              style={{ background: showProgressBar ? "var(--color-selection)" : "var(--border-nav)" }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
                style={{
                  background: "#fff",
                  left: showProgressBar ? "calc(100% - 1.125rem)" : "0.125rem",
                }}
              />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--text-primary)" }}>
              {t("settings.pageCount")}
            </span>
            <button
              onClick={onTogglePageCount}
              className="w-9 h-5 rounded-full relative transition-colors"
              style={{ background: showPageCount ? "var(--color-selection)" : "var(--border-nav)" }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
                style={{
                  background: "#fff",
                  left: showPageCount ? "calc(100% - 1.125rem)" : "0.125rem",
                }}
              />
            </button>
          </div>
          <button
            className="w-full py-1.5 text-xs rounded text-left px-3 transition-colors hover:bg-[var(--bg-tab-active)]"
            style={{ color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
            onClick={onRefreshMetadata}
          >
            {t("settings.refreshMetadata")}
          </button>
          <button
            className="w-full py-1.5 text-xs rounded text-left px-3 transition-colors hover:bg-[var(--bg-tab-active)]"
            style={{ color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
            onClick={handleExport}
          >
            {t("settings.export")}
          </button>
          {importPending ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings.importConfirmMsg")}
              </p>
              <div className="flex gap-2">
                <button
                  className="flex-1 py-1.5 text-xs rounded transition-colors"
                  style={{ background: "var(--color-danger)", color: "#fff" }}
                  onClick={handleImportConfirm}
                >
                  {t("settings.importConfirm")}
                </button>
                <button
                  className="flex-1 py-1.5 text-xs rounded transition-colors hover:bg-[var(--bg-tab-active)]"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border-nav)" }}
                  onClick={() => setImportPending(false)}
                >
                  {t("settings.importCancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full py-1.5 text-xs rounded text-left px-3 transition-colors hover:bg-[var(--bg-tab-active)]"
              style={{ color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
              onClick={() => setImportPending(true)}
            >
              {t("settings.import")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
