import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MEDIA_LIST_STATUSES, type MediaListEdit, type MediaListStatus } from "../utils/anilistApi";
import { choiceRawFor, NO_SCORE, RAW_SCORE_MAX, rawFromInput, scoreControl } from "../utils/anilistScore";
import { getCachedSeriesPanel, loadSeriesPanel, saveSeriesEdit, type SeriesPanelData } from "../utils/anilistSync";
import type { SeriesLink } from "../utils/anilistStore";
import Button from "./Button";
import Spinner from "./Spinner";

type Form = { status: MediaListStatus | null; progress: number; progressVolumes: number; score: number };

const INPUT_CLASS = "w-20 px-2 py-1 text-sm rounded outline-none";
const INPUT_STYLE = { background: "var(--bg-tab-active)", color: "var(--text-primary)", border: "1px solid var(--border-nav)" };
const SKELETON_STYLE = { background: "var(--bg-tab-active)" };
// Same dim as Modal's backdrop, for the expanded cover.
const COVER_BACKDROP_COLOR = "rgba(0,0,0,0.62)";
// Form rows shown as placeholders while AniList answers (status, chapters, volumes, score).
const SKELETON_FORM_ROWS = 4;

function formFrom(link: SeriesLink): Form {
  const entry = link.entry ?? null;
  return {
    status: entry?.status ?? null,
    progress: entry?.progress ?? 0,
    progressVolumes: entry?.progressVolumes ?? 0,
    score: entry?.score ?? NO_SCORE,
  };
}

/** Only the fields that differ from what AniList (or the cache) holds. */
function changedFields(form: Form, original: Form): MediaListEdit {
  const edit: MediaListEdit = {};
  if (form.status !== null && form.status !== original.status) edit.status = form.status;
  if (form.progress !== original.progress) edit.progress = form.progress;
  if (form.progressVolumes !== original.progressVolumes) edit.progressVolumes = form.progressVolumes;
  if (form.score !== original.score) edit.score = form.score;
  return edit;
}

const clampCount = (value: number, total: number | null) =>
  Math.max(0, Math.min(Number.isFinite(value) ? Math.floor(value) : 0, total ?? Infinity));

/**
 * Number input that keeps the typed text while focused: a controlled value would
 * rewrite "0." or a cleared field mid-typing. `value` null shows an empty field.
 */
function NumberField({
  id,
  value,
  max,
  step,
  onChange,
}: {
  id?: string;
  value: number | null;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      min={0}
      max={max}
      step={step}
      value={text ?? (value === null ? "" : String(value))}
      onChange={(e) => { setText(e.target.value); onChange(e.target.valueAsNumber); }}
      onBlur={() => setText(null)}
      className={INPUT_CLASS}
      style={INPUT_STYLE}
    />
  );
}

/**
 * Per-series AniList panel: a right sidebar laid out beside the library list
 * (LibraryView gives it its own column, so the list narrows instead of being
 * covered; clicking another AL badge switches series). Shows the cached link at once,
 * then the fresh series info and the viewer's entry (status, progress, score in
 * the account's format) plus relink/unlink. Edits are sent together on Save;
 * offline they are queued (see saveSeriesEdit).
 */
function AniListSeriesPanel({
  folderName,
  cachedLink,
  onRelink,
  onUnlink,
  onLinkChanged,
  onClose,
  continueAction,
}: {
  folderName: string;
  /** The stored link, shown while the fresh data loads. */
  cachedLink: SeriesLink | undefined;
  onRelink: () => void;
  onUnlink: () => void;
  /** The stored link was refreshed or edited (title/cover may have changed). */
  onLinkChanged: (link: SeriesLink) => void;
  onClose: () => void;
  /** Continue/start reading this series in the library, shown under the form. */
  continueAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<SeriesPanelData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  // Once the user edits, a Retry refreshes the data but keeps their form.
  const touchedRef = useRef(false);
  const [original, setOriginal] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  // Held in refs so new parent callbacks don't refetch or re-subscribe.
  const onLinkChangedRef = useRef(onLinkChanged);
  useEffect(() => { onLinkChangedRef.current = onLinkChanged; }, [onLinkChanged]);
  const [coverExpanded, setCoverExpanded] = useState(false);
  const coverExpandedRef = useRef(false);
  useEffect(() => { coverExpandedRef.current = coverExpanded; }, [coverExpanded]);

  useEffect(() => {
    // Escape on an expanded cover closes only the cover: caught in the capture phase and stopped before
    // LibraryView's Escape (selection, then the sidebar itself) sees it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !coverExpandedRef.current) return;
      e.stopPropagation();
      setCoverExpanded(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let fresh = false;
    const show = (loaded: SeriesPanelData) => {
      const initial = formFrom(loaded.link);
      setData(loaded);
      setOriginal(initial);
      setForm((prev) => (touchedRef.current && prev ? prev : initial));
    };
    // A series opened before shows its cached data at once; the fetch below then
    // refreshes it in place, without a loading state.
    getCachedSeriesPanel(folderName)
      .then((cached) => { if (!cancelled && !fresh && cached) show(cached); })
      .catch(console.error);
    loadSeriesPanel(folderName)
      .then((loaded) => {
        if (cancelled) return;
        fresh = true;
        show(loaded);
        setLoadError(false);
        setReloading(false);
        onLinkChangedRef.current(loaded.link);
      })
      .catch((err) => {
        console.error("[anilist panel]", err);
        if (cancelled) return;
        setLoadError(true);
        setReloading(false);
      });
    return () => { cancelled = true; };
  }, [folderName, reloadKey]);

  const edit = form && original ? changedFields(form, original) : {};
  const dirty = Object.keys(edit).length > 0;

  const handleSave = async () => {
    if (!data || !dirty) return;
    setSaving(true);
    setSaveError(false);
    try {
      await saveSeriesEdit(folderName, data.link, edit);
      onClose();
    } catch (err) {
      console.error("[anilist save]", err);
      setSaveError(true);
      setSaving(false);
    }
  };

  const link = data?.link ?? cachedLink;
  const info = link?.info;
  const meta = link
    ? [
        info?.format,
        info?.year,
        link.volumes !== null ? t("anilist.volumesCount", { count: link.volumes }) : null,
        link.chapters !== null ? t("anilist.chaptersCount", { count: link.chapters }) : null,
      ].filter((d) => d !== null && d !== undefined)
    : [];
  const control = data ? scoreControl(data.scoreFormat) : null;
  const coverSrc = info?.coverLargeUrl ?? link?.coverUrl;
  const expandedCoverSrc = info?.coverExtraLargeUrl ?? coverSrc;
  const loading = !data && !loadError;
  const update = (patch: Partial<Form>) => {
    touchedRef.current = true;
    setForm((f) => (f ? { ...f, ...patch } : f));
  };
  const retry = () => {
    setReloading(true);
    setReloadKey((k) => k + 1);
  };

  return (
    <aside
      className="kr-slide-in shrink-0 w-[400px] max-w-[50%] min-h-0 flex flex-col"
      style={{ background: "var(--bg-nav)", borderLeft: "1px solid var(--border-nav)" }}
    >
      <header className="flex items-center justify-between gap-2 px-5 py-4" style={{ borderBottom: "1px solid var(--border-nav)" }}>
        <h2 className="font-display text-base font-semibold truncate" style={{ color: "var(--text-primary)" }}>
          {link?.title ?? folderName}
        </h2>
        <button
          onClick={onClose}
          aria-label={t("anilist.close")}
          title={t("anilist.close")}
          className="text-lg leading-none opacity-60 hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {loading && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
            <Spinner />
            <span>{t("anilist.panelLoading")}</span>
          </div>
        )}
        {loadError && (
          <div className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--color-danger)" }}>
            <span>{t("anilist.panelLoadError")}</span>
            <Button size="sm" disabled={reloading} onClick={retry}>{t("anilist.retry")}</Button>
          </div>
        )}
        {data?.stale && (
          <div
            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs"
            style={{ background: "var(--bg-tab-active)", color: "var(--text-secondary)" }}
          >
            <span>{t(data.stale === "offline" ? "anilist.staleOffline" : "anilist.staleAuth")}</span>
            <Button size="sm" disabled={reloading} onClick={retry}>{t("anilist.retry")}</Button>
          </div>
        )}

        <div className="flex gap-4">
          {coverSrc ? (
            <button
              type="button"
              onClick={() => setCoverExpanded(true)}
              aria-label={t("anilist.expandCover")}
              title={t("anilist.expandCover")}
              className="shrink-0 rounded cursor-zoom-in transition-transform hover:scale-[1.02]"
            >
              <img src={coverSrc} alt="" className="w-28 h-40 object-cover rounded" />
            </button>
          ) : (
            <div className={`w-28 h-40 rounded shrink-0 ${loading ? "animate-pulse" : ""}`} style={SKELETON_STYLE} />
          )}
          <div className="flex flex-col gap-2 min-w-0">
            {meta.length > 0 && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{meta.join(" · ")}</span>}
            {info && info.genres.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {info.genres.map((genre) => (
                  <span
                    key={genre}
                    className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{ background: "var(--bg-tab-active)", color: "var(--text-secondary)" }}
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}
            {!info && loading && (
              <div className="flex flex-col gap-2 animate-pulse">
                <div className="h-3 w-32 rounded" style={SKELETON_STYLE} />
                <div className="h-3 w-24 rounded" style={SKELETON_STYLE} />
              </div>
            )}
            {info?.siteUrl && (
              <button
                onClick={() => { openUrl(info.siteUrl).catch(console.error); }}
                className="self-start text-xs hover:underline"
                style={{ color: "var(--accent)" }}
              >
                {t("anilist.openOnAniList")}
              </button>
            )}
          </div>
        </div>

        {info?.description && (
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
            <p className={`whitespace-pre-line ${descriptionExpanded ? "" : "line-clamp-5"}`}>{info.description}</p>
            <button
              onClick={() => setDescriptionExpanded((v) => !v)}
              className="mt-1 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {t(descriptionExpanded ? "anilist.showLess" : "anilist.showMore")}
            </button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col gap-3 animate-pulse">
            {Array.from({ length: SKELETON_FORM_ROWS }, (_, i) => (
              <div key={i} className="h-7 rounded" style={SKELETON_STYLE} />
            ))}
          </div>
        )}

        {data && link && form && control && (
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-sm" style={{ color: "var(--text-primary)" }}>
            <label htmlFor="anilist-status">{t("anilist.statusLabel")}</label>
            <select
              id="anilist-status"
              value={form.status ?? ""}
              onChange={(e) => update({ status: e.target.value as MediaListStatus })}
              className="justify-self-start px-2 py-1 text-sm rounded outline-none"
              style={INPUT_STYLE}
            >
              {form.status === null && <option value="" disabled>{t("anilist.notOnList")}</option>}
              {MEDIA_LIST_STATUSES.map((status) => (
                <option key={status} value={status}>{t(`anilist.status.${status}`)}</option>
              ))}
            </select>

            <label htmlFor="anilist-chapters">{t("anilist.chaptersLabel")}</label>
            <span className="flex items-center gap-2">
              <NumberField
                id="anilist-chapters"
                max={link.chapters ?? undefined}
                value={form.progress}
                onChange={(n) => update({ progress: clampCount(n, link.chapters) })}
              />
              {link.chapters !== null && <span style={{ color: "var(--text-muted)" }}>/ {link.chapters}</span>}
            </span>

            <label htmlFor="anilist-volumes">{t("anilist.volumesLabel")}</label>
            <span className="flex items-center gap-2">
              <NumberField
                id="anilist-volumes"
                max={link.volumes ?? undefined}
                value={form.progressVolumes}
                onChange={(n) => update({ progressVolumes: clampCount(n, link.volumes) })}
              />
              {link.volumes !== null && <span style={{ color: "var(--text-muted)" }}>/ {link.volumes}</span>}
            </span>

            <span>{t("anilist.scoreLabel")}</span>
            <span className="flex flex-wrap items-center gap-1">
              {control.kind === "choices" ? (
                control.choices.map((choice) => {
                  const active = choiceRawFor(form.score, data.scoreFormat) === choice.raw;
                  return (
                    <button
                      key={choice.raw}
                      onClick={() => update({ score: active ? NO_SCORE : choice.raw })}
                      className="min-w-7 px-1.5 py-0.5 rounded text-sm transition-colors"
                      style={{
                        background: active ? "var(--accent)" : "var(--bg-tab-active)",
                        color: active ? "var(--accent-ink)" : "var(--text-primary)",
                      }}
                    >
                      {choice.label}
                    </button>
                  );
                })
              ) : (
                <NumberField
                  max={RAW_SCORE_MAX / control.divisor}
                  step={control.step}
                  value={form.score === NO_SCORE ? null : form.score / control.divisor}
                  onChange={(n) => update({ score: rawFromInput(n, control.divisor) })}
                />
              )}
              {form.score !== NO_SCORE && (
                <button
                  onClick={() => update({ score: NO_SCORE })}
                  className="ml-1 text-xs hover:underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("anilist.clearScore")}
                </button>
              )}
            </span>
          </div>
        )}

        {continueAction}

        {saveError && (
          <p className="text-xs" style={{ color: "var(--color-danger)" }}>{t("anilist.saveError")}</p>
        )}
      </div>

      <footer className="flex flex-col gap-2 px-5 py-4" style={{ borderTop: "1px solid var(--border-nav)" }}>
        <div className="flex gap-2 justify-end">
          <Button size="sm" onClick={onClose}>{t("library.cancel")}</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || saving || reloading}
            onClick={() => { handleSave().catch(console.error); }}
          >
            {t(saving ? "anilist.saving" : "anilist.save")}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onRelink}>{t("anilist.relink")}</Button>
          <Button variant="danger" size="sm" onClick={onUnlink}>{t("anilist.unlink")}</Button>
        </div>
      </footer>

      {/* Portaled: the sidebar's slide-in animation keeps a transform, which would
          make it the containing block of this fixed overlay (centered on the sidebar). */}
      {coverExpanded && expandedCoverSrc && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="kr-pop fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm cursor-zoom-out"
          style={{ background: COVER_BACKDROP_COLOR }}
          onClick={() => setCoverExpanded(false)}
        >
          <img
            src={expandedCoverSrc}
            alt={link?.title ?? ""}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>,
        document.body,
      )}
    </aside>
  );
}

export default AniListSeriesPanel;
