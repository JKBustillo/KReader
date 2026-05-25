import { useTranslation } from "react-i18next";

type Props = {
  showMoreInfo: boolean;
  showOverlay: boolean;
  pinPageIndicator: boolean;
  cascadeMode: boolean;
  webtoonMode: boolean;
  doublePage: boolean;
  rtl: boolean;
  showGap: boolean;
  zoom: number;
  pageIndex: number;
  pagesLength: number;
};

function ReaderOverlay({
  showMoreInfo,
  showOverlay,
  pinPageIndicator,
  cascadeMode,
  webtoonMode,
  doublePage,
  rtl,
  showGap,
  zoom,
  pageIndex,
  pagesLength,
}: Props) {
  const { t } = useTranslation();

  const shortcutsVisible = showMoreInfo || showOverlay;
  const infoVisible = showMoreInfo || showOverlay || pinPageIndicator;

  const modeLabel = webtoonMode
    ? `📜 ${t("reader.modeWebtoon")}`
    : cascadeMode
      ? `🧩 ${t("reader.modeCascade")}`
      : doublePage
        ? `📖 ${t("reader.modeDouble")}`
        : `📄 ${t("reader.modeSingle")}`;

  return (
    <>
      <div
        className="fixed top-4 right-4 text-sm px-3 py-2 rounded select-none"
        style={{
          background: "var(--bg-overlay)",
          color: "var(--text-overlay)",
          opacity: shortcutsVisible ? 0.3 : 0,
          transition: "opacity 0.3s ease",
          pointerEvents: shortcutsVisible ? "auto" : "none",
        }}
      >
        {showMoreInfo ? (
          <>
            <div className="font-semibold mb-1 text-center tracking-wide">{t("shortcuts.title")}</div>
            <table style={{ borderSpacing: "0 2px", borderCollapse: "separate" }}>
              <tbody>
                {[
                  ["← / →",            t("shortcuts.prevNext")],
                  ["PageUp / PageDown", t("shortcuts.scrollOrTurn")],
                  ["Home / End",       t("shortcuts.firstLast")],
                  ["Ctrl+← / →",       t("shortcuts.prevNextFile")],
                  ["W",                t("shortcuts.webtoon")],
                  ["C",                t("shortcuts.cascade")],
                  ["D",                t("shortcuts.doublePage")],
                  ["S",                t("shortcuts.rtl")],
                  ["G",                t("shortcuts.gap")],
                  ["+ / −",            t("shortcuts.zoom")],
                  ["J",                t("shortcuts.smoothScroll")],
                  ["F",                t("shortcuts.fullscreen")],
                  ["I",                t("shortcuts.showHide")],
                  ["Escape",           t("shortcuts.closeReader")],
                  ["X",                t("shortcuts.closeWindow")],
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td className="pr-3 text-right font-mono text-[var(--text-key)] whitespace-nowrap">{key}</td>
                    <td className="text-[var(--text-overlay)] whitespace-nowrap">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <span className="font-mono">{t("shortcuts.hint")}</span>
        )}
      </div>

      <div
        className="fixed bottom-4 right-4 text-sm px-3 py-2 rounded"
        style={{
          background: "var(--bg-overlay)",
          color: "var(--text-overlay)",
          opacity: infoVisible ? 0.3 : 0,
          transition: "opacity 0.3s ease",
          pointerEvents: infoVisible ? "auto" : "none",
        }}
      >
        {showMoreInfo && (
          <>
            <div>{modeLabel}</div>
            <div>{t("reader.orientation")}: {rtl ? `⇠ ${t("reader.rtl")}` : `⇢ ${t("reader.ltr")}`}</div>
            <div>{showGap ? t("reader.withGap") : t("reader.withoutGap")}</div>
            <div>{t("reader.zoom")}: {Math.round(zoom * 100)}%</div>
          </>
        )}
        <div>
          {showMoreInfo && `${t("reader.page")} `}
          {pageIndex + 1} {t("reader.of")} {pagesLength}
        </div>
      </div>
    </>
  );
}

export default ReaderOverlay;
