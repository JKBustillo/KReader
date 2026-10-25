import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ANILIST_SYNC_EVENT,
  AniListUndoConflictError,
  undoSync,
  type AniListSyncNotice,
} from "../utils/anilistSync";

const TOAST_DURATION_MS = 6000;

type ToastState =
  | { notice: AniListSyncNotice; undo?: "pending" | "done" | "conflict" | "failed" }
  | null;

/**
 * Brief AniList feedback shown in the window where a file was completed, with
 * an Undo action for successful syncs. A newer notice replaces the current one.
 */
function AniListToast() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  };

  useEffect(() => {
    const onNotice = (e: Event) => {
      setToast({ notice: (e as CustomEvent<AniListSyncNotice>).detail });
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
      className="kr-pop fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-2xl text-sm max-w-[90vw]"
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
  );
}

export default AniListToast;
