import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { exportLibraryData, importLibraryData } from "../utils/libraryStore";
import type { Theme } from "../utils/theme";
import type { AccentId } from "../utils/accent";
import Button from "./Button";

// Accent options shown as swatches. Each swatch carries its own `data-accent`
// attribute so `var(--accent)` resolves to that option's color (defined in
// App.css) — no hardcoded hex in the component.
const ACCENTS: { id: AccentId; labelKey: string }[] = [
  { id: "ice", labelKey: "settings.accentIce" },
  { id: "violet", labelKey: "settings.accentViolet" },
];

// Glyphs for the data-action buttons. Up = export (out of app), down = import (into app).
const ICON_REFRESH = "↻";
const ICON_EXPORT = "↥";
const ICON_IMPORT = "↧";

// Single display-preference row: label on the left, pill toggle on the right.
function ToggleRow({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: "var(--text-primary)" }}>
        {label}
      </span>
      <button
        onClick={onToggle}
        className="w-9 h-5 rounded-full relative transition-colors shrink-0"
        style={{ background: active ? "var(--color-selection)" : "var(--border-nav)" }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
          style={{ background: "#fff", left: active ? "calc(100% - 1.125rem)" : "0.125rem" }}
        />
      </button>
    </div>
  );
}

function SettingsModal({
  open: isOpen,
  onClose,
  theme,
  onToggleTheme,
  accent,
  onSetAccent,
  language,
  onSetLanguage,
  showProgressBar,
  onToggleProgressBar,
  showPageCount,
  onTogglePageCount,
  autoBackup,
  onToggleAutoBackup,
  keepDataOnRemove,
  onToggleKeepDataOnRemove,
  onRefreshMetadata,
}: {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  accent: AccentId;
  onSetAccent: (accent: AccentId) => void;
  language: string;
  onSetLanguage: (lang: string) => void;
  showProgressBar: boolean;
  onToggleProgressBar: () => void;
  showPageCount: boolean;
  onTogglePageCount: () => void;
  autoBackup: boolean;
  onToggleAutoBackup: () => void;
  keepDataOnRemove: boolean;
  onToggleKeepDataOnRemove: () => void;
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
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.62)" }}
      onClick={onClose}
    >
      <div
        className="max-w-sm w-full rounded-2xl p-5 flex flex-col gap-5"
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

        {/* Accent color */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {t("settings.accent")}
          </p>
          <div className="flex gap-2">
            {ACCENTS.map(({ id, labelKey }) => (
              <button
                key={id}
                data-accent={id}
                onClick={() => onSetAccent(id)}
                className="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs rounded transition-colors"
                style={accent === id ? chipActive : chipInactive}
              >
                <span className="w-3.5 h-3.5 rounded-full" style={{ background: "var(--accent)" }} />
                {t(labelKey)}
              </button>
            ))}
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
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {t("settings.library")}
          </p>

          {/* Display preferences grouped in a subtle card */}
          <div
            className="flex flex-col gap-2.5 rounded-lg p-3"
            style={{ background: "var(--bg-tab-active)", border: "1px solid var(--border-nav)" }}
          >
            <ToggleRow label={t("settings.progressBar")} active={showProgressBar} onToggle={onToggleProgressBar} />
            <ToggleRow label={t("settings.pageCount")} active={showPageCount} onToggle={onTogglePageCount} />
          </div>

          {/* Data actions */}
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {t("settings.data")}
          </p>
          <div
            className="flex flex-col gap-2.5 rounded-lg p-3"
            style={{ background: "var(--bg-tab-active)", border: "1px solid var(--border-nav)" }}
          >
            <ToggleRow label={t("settings.autoBackup")} active={autoBackup} onToggle={onToggleAutoBackup} />
            <ToggleRow label={t("settings.keepDataOnRemove")} active={keepDataOnRemove} onToggle={onToggleKeepDataOnRemove} />
          </div>
          <Button variant="secondary" className="w-full" onClick={onRefreshMetadata}>
            <span aria-hidden="true">{ICON_REFRESH}</span>
            {t("settings.refreshMetadata")}
          </Button>

          {importPending ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings.importConfirmMsg")}
              </p>
              <div className="flex gap-2">
                <Button variant="danger" className="flex-1" onClick={handleImportConfirm}>
                  {t("settings.importConfirm")}
                </Button>
                <Button variant="secondary" className="flex-1" onClick={() => setImportPending(false)}>
                  {t("settings.importCancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={handleExport}>
                <span aria-hidden="true">{ICON_EXPORT}</span>
                {t("settings.exportShort")}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setImportPending(true)}>
                <span aria-hidden="true">{ICON_IMPORT}</span>
                {t("settings.importShort")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
