import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AniListAuthError,
  connectAniList,
  disconnectAniList,
  getViewerName,
  isAniListConnected,
  openAniListAuthorization,
} from "../utils/anilistApi";
import { flushPendingSyncs } from "../utils/anilistSync";
import Button from "./Button";

type ConnectionState =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "awaitingToken" }
  | { kind: "connected"; name: string | null }
  | { kind: "expired" };

/** SettingsModal section: connect (browser + paste token), show account, disconnect. */
function AniListSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState<ConnectionState>({ kind: "loading" });
  const [token, setToken] = useState("");
  const [connectError, setConnectError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await isAniListConnected())) {
        if (!cancelled) setState({ kind: "disconnected" });
        return;
      }
      try {
        const name = await getViewerName();
        if (!cancelled) setState({ kind: "connected", name });
      } catch (err) {
        // Offline is not a reason to look disconnected; only a rejected token is.
        if (!cancelled) setState(err instanceof AniListAuthError ? { kind: "expired" } : { kind: "connected", name: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleStart = async () => {
    setConnectError(false);
    setToken("");
    setState({ kind: "awaitingToken" });
    await openAniListAuthorization().catch(console.error);
  };

  const handleConnect = async () => {
    try {
      const name = await connectAniList(token);
      setState({ kind: "connected", name });
      flushPendingSyncs().catch(console.error);
    } catch (err) {
      console.error("[anilist connect]", err);
      setConnectError(true);
    }
  };

  const handleDisconnect = async () => {
    await disconnectAniList().catch(console.error);
    setState({ kind: "disconnected" });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {t("anilist.title")}
      </p>
      <div
        className="flex flex-col gap-2.5 rounded-lg p-3"
        style={{ background: "var(--bg-tab-active)", border: "1px solid var(--border-nav)" }}
      >
        {state.kind === "loading" && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>…</span>
        )}

        {(state.kind === "disconnected" || state.kind === "expired") && (
          <>
            <span className="text-xs" style={{ color: state.kind === "expired" ? "var(--color-danger)" : "var(--text-secondary)" }}>
              {state.kind === "expired" ? t("anilist.expired") : t("anilist.disconnectedHint")}
            </span>
            <Button variant="secondary" className="w-full" onClick={handleStart}>
              {t("anilist.connect")}
            </Button>
          </>
        )}

        {state.kind === "awaitingToken" && (
          <>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("anilist.pasteTokenHint")}
            </span>
            <textarea
              value={token}
              onChange={(e) => { setToken(e.target.value); setConnectError(false); }}
              rows={3}
              className="w-full px-2 py-1.5 text-xs rounded outline-none resize-none font-mono"
              style={{ background: "var(--bg-nav)", color: "var(--text-primary)", border: "1px solid var(--border-nav)" }}
            />
            {connectError && (
              <span className="text-xs" style={{ color: "var(--color-danger)" }}>{t("anilist.connectError")}</span>
            )}
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" disabled={!token.trim()} onClick={handleConnect}>
                {t("anilist.saveToken")}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setState({ kind: "disconnected" })}>
                {t("settings.importCancel")}
              </Button>
            </div>
          </>
        )}

        {state.kind === "connected" && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs truncate" style={{ color: "var(--text-primary)" }}>
              {state.name ? t("anilist.connectedAs", { name: state.name }) : t("anilist.connectedOffline")}
            </span>
            <Button variant="danger" size="sm" onClick={handleDisconnect}>
              {t("anilist.disconnect")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AniListSettings;
