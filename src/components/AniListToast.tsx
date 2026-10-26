import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ANILIST_SYNC_EVENT,
  AniListUndoConflictError,
  undoSync,
  type AniListSyncNotice,
} from "../utils/anilistSync";

const TOAST_DURATION_MS = 6000;
// Grace period after the cursor leaves a recalled notice, so a slight overshoot doesn't close it.
const RECALL_HIDE_MS = 800;

type ToastState =
  | { notice: AniListSyncNotice; undo?: "pending" | "done" | "conflict" | "failed" }
  | null;

const markerColor = (toast: NonNullable<ToastState>): string => {
  if (toast.undo === "done") return "var(--text-muted)";
  switch (toast.notice.kind) {
    case "synced": return "var(--color-progress-complete)";
    case "failed": return "var(--color-danger)";
    default: return "var(--color-progress-inprogress)";
  }
};

/**
 * Brief AniList feedback shown in the window where a file was completed, with
 * an Undo action for successful syncs. A newer notice replaces the current one.
 * Once hidden, a small marker stays at the bottom edge; hovering it shows the
 * last notice again (Undo included while it still applies).
 */
function AniListToast() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<ToastState>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);

  const scheduleHide = (delayMs = TOAST_DURATION_MS) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (hoveredRef.current) return;
    timerRef.current = setTimeout(() => setVisible(false), delayMs);
  };

  const handleMouseEnter = () => {
    hoveredRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
  };

  const handleMouseLeave = () => {
    hoveredRef.current = false;
    scheduleHide(RECALL_HIDE_MS);
  };

  useEffect(() => {
    const onNotice = (e: Event) => {
      setToast({ notice: (e as CustomEvent<AniListSyncNotice>).detail });
      setVisible(true);
      scheduleHide();
    };
    window.addEventListener(ANILIST_SYNC_EVENT, onNotice);
    return () => {
      window.removeEventListener(ANILIST_SYNC_EVENT, onNotice);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;
  const { notice, undo } = toast;

  const handleUndo = async () => {
    if (notice.kind !== "synced") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ notice, undo: "pending" });
    try {
      await undoSync(notice);
      setToast({ notice, undo: "done" });
    } catch (err) {
      if (!(err instanceof AniListUndoConflictError)) console.error("[anilist undo]", err);
      setToast({ notice, undo: err instanceof AniListUndoConflictError ? "conflict" : "failed" });
    }
    scheduleHide();
  };

  let message: string;
  if (notice.kind === "synced") {
    const parts = [
      notice.next.progressVolumes > 0 ? t("anilist.volumeN", { n: notice.next.progressVolumes }) : null,
      notice.next.progress > 0 ? t("anilist.chapterN", { n: notice.next.progress }) : null,
      notice.next.status === "COMPLETED" ? t("anilist.completed") : null,
    ].filter(Boolean);
    message = undo === "done"
      ? t("anilist.undone", { title: notice.title })
      : undo === "conflict"
        ? t("anilist.undoConflict")
        : undo === "failed"
          ? t("anilist.undoFailed")
          : t("anilist.synced", { title: notice.title, progress: parts.join(" · ") });
  } else if (notice.kind === "queued") {
    message = t("anilist.queued", { title: notice.title });
  } else if (notice.kind === "authRequired") {
    message = t("anilist.authRequired");
  } else {
    message = t("anilist.failed", { title: notice.title });
  }

  const canUndo = notice.kind === "synced" && undo === undefined;

  return (
    <div
      className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center max-w-[90vw]"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {visible && (
        <div
          className="kr-pop flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-2xl text-sm max-w-full"
          style={{ background: "var(--bg-nav)", border: "1px solid var(--border-nav)", color: "var(--text-primary)" }}
        >
          <span className="truncate">{message}</span>
          {canUndo && (
            <button
              onClick={handleUndo}
              className="shrink-0 text-xs font-semibold uppercase tracking-wide hover:opacity-80"
              style={{ color: "var(--accent)" }}
            >
              {t("anilist.undo")}
            </button>
          )}
        </div>
      )}
      {/* Hover target for recalling the notice; taller than the marker so it's easy to hit. */}
      <div className="w-40 h-5 flex items-end justify-center pb-1" aria-hidden>
        <span
          className="w-8 h-[3px] rounded-full transition-opacity"
          style={{ background: markerColor(toast), opacity: visible ? 0 : 0.7 }}
        />
      </div>
    </div>
  );
}

export default AniListToast;
