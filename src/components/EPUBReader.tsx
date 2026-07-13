import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ePub, { type Book, type Rendition } from "epubjs";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useOverlayAutoHide } from "../hooks/useOverlayAutoHide";
import { usePinPageIndicator } from "../hooks/usePinPageIndicator";
import {
  getEpubCfi,
  saveEpubCfi,
  getEpubLocations,
  saveEpubLocations,
  savePage,
} from "../utils/readingProgressStore";
import { getEpubFontSize, saveEpubFontSize } from "../utils/settingsStore";
import { basename } from "../utils/folderUtils";
import { setWindowTitle } from "../utils/appWindow";
import type { Theme } from "../utils/theme";

// One epubjs "location" per this many characters — the tradeoff between % precision
// and generate() cost. 1600 is epubjs's own default.
const LOCATIONS_CHARS = 1600;
// Font-size clamps (percent of the book's base size), applied via rendition.themes.
const FONT_STEP = 10;
const FONT_MIN = 70;
const FONT_MAX = 250;
const FONT_DEFAULT = 100;
// Book-wide % at which the book counts as finished (locations % never quite hits 1).
const COMPLETE_THRESHOLD = 0.999;
const EPUB_THEME_NAME = "kreader";

// epubjs types we actually read (its own types are loose around these callbacks).
type Loc = { start: { cfi: string; href: string; percentage: number }; atEnd?: boolean };
type TocItem = { href: string; label: string; subitems?: TocItem[] };
// epubjs's shipped types are wrong here: locationFromCfi returns the numeric index
// (not a Location), and `total` (the max index) isn't declared. Narrow to what we use.
type EpubLocations = {
  total: number;
  generate(chars: number): Promise<unknown>;
  load(json: string): void;
  save(): string;
  locationFromCfi(cfi: string): number;
  percentageFromCfi(cfi: string): number;
};

const stripFragment = (href: string) => href.split("#")[0];

// Resolves a TOC href (which epubjs stores raw, relative to the nav/ncx document)
// to an OPF-relative href that matches epubjs's spine map. Without this, a book
// whose nav lives in a subfolder (e.g. Text/nav.xhtml) produces hrefs like
// "cubierta.xhtml" that never match the spine's "Text/cubierta.xhtml", so both
// TOC navigation and chapter-label lookup silently fail.
function resolveHref(navBase: string, href: string): string {
  const [path, ...frag] = href.split("#");
  const baseDir = navBase.includes("/") ? navBase.slice(0, navBase.lastIndexOf("/") + 1) : "";
  const parts: string[] = [];
  for (const seg of (baseDir + path).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const resolved = parts.join("/");
  return frag.length > 0 ? `${resolved}#${frag.join("#")}` : resolved;
}

// Build the in-book theme from the app's live CSS tokens, so the book content
// tracks the same palette as the chrome (the iframe has no access to :root vars).
function buildThemeStyles() {
  const s = getComputedStyle(document.documentElement);
  const bg = s.getPropertyValue("--bg-primary").trim();
  const fg = s.getPropertyValue("--text-primary").trim();
  const link = s.getPropertyValue("--accent").trim();
  // ponytail: force text color on common elements so books that hard-code black
  // stay legible on a dark background. Images are left untouched.
  return {
    body: { background: `${bg} !important`, color: `${fg} !important` },
    "p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, blockquote": { color: `${fg} !important` },
    "a, a:link, a:visited": { color: `${link} !important` },
  };
}

export default function EPUBReader({
  data,
  filePath,
  theme,
  onClose,
  onLastPage,
  onPagesLoaded,
}: {
  data: Uint8Array;
  filePath: string;
  theme: Theme;
  onClose: () => void;
  onLastPage?: () => void;
  onPagesLoaded?: (total: number) => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);
  const locReadyRef = useRef(false);
  const lastCfiRef = useRef("");
  const lastPageFiredRef = useRef(false);
  const tocFlatRef = useRef<Map<string, string>>(new Map());
  const navBaseRef = useRef("");
  const fontLoadedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [chapter, setChapter] = useState("");
  const [toc, setToc] = useState<TocItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [fontPct, setFontPct] = useState(FONT_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const { showOverlay, setShowOverlay } = useOverlayAutoHide(showInfo);
  const [pinPageIndicator, setPinPageIndicator] = usePinPageIndicator();

  // Load + render the book. All setState runs after an await (never synchronously
  // in the effect body), so construction errors flow through the single .catch.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    locReadyRef.current = false;
    lastPageFiredRef.current = false;

    (async () => {
      // Fresh copy: the effect may run twice under StrictMode and epubjs/JSZip
      // can consume the buffer, so never hand it the prop's own ArrayBuffer.
      const book = (bookRef.current = ePub(data.slice().buffer));
      const rendition = book.renderTo(el, { width: "100%", height: "100%", flow: "paginated", spread: "none" });
      renditionRef.current = rendition;
      const locations = book.locations as unknown as EpubLocations;

      rendition.on("relocated", (loc: Loc) => {
        lastCfiRef.current = loc.start.cfi;
        setChapter(tocFlatRef.current.get(stripFragment(loc.start.href)) ?? "");
        saveEpubCfi(filePath, loc.start.cfi).catch(console.error);
        if (!locReadyRef.current) {
          setPercent(loc.start.percentage);
          return;
        }
        const pct = locations.percentageFromCfi(loc.start.cfi);
        setPercent(pct);
        // Mirror the position into the shared page key so the library progress
        // bar works for EPUB without any special-casing downstream.
        savePage(filePath, locations.locationFromCfi(loc.start.cfi)).catch(console.error);
        if (pct >= COMPLETE_THRESHOLD && !lastPageFiredRef.current) {
          lastPageFiredRef.current = true;
          onLastPage?.();
        }
      });

      const savedCfi = await getEpubCfi(filePath);
      if (cancelled) return;
      await rendition.display(savedCfi ?? undefined);
      if (cancelled) return;

      const nav = await book.loaded.navigation;
      if (cancelled) return;
      // TOC hrefs are relative to the nav/ncx document, not the OPF; resolve them
      // so both navigation and chapter lookup match the spine.
      const packaging = book.packaging as { navPath?: string; ncxPath?: string };
      const navBase = packaging.navPath || packaging.ncxPath || "";
      navBaseRef.current = navBase;
      const items = (nav.toc as TocItem[]) ?? [];
      const flat = new Map<string, string>();
      const walk = (list: TocItem[]) =>
        list.forEach((it) => {
          flat.set(stripFragment(resolveHref(navBase, it.href)), it.label.trim());
          if (it.subitems) walk(it.subitems);
        });
      walk(items);
      tocFlatRef.current = flat;
      setToc(items);
      setReady(true);

      // Locations power the book-wide %. Reuse the cached table when present so
      // reopening is instant; only generate (slow on big books) on first open.
      const cached = await getEpubLocations(filePath);
      if (cancelled) return;
      if (cached) locations.load(cached);
      else {
        await locations.generate(LOCATIONS_CHARS);
        if (cancelled) return;
        await saveEpubLocations(filePath, locations.save());
      }
      if (cancelled) return;
      locReadyRef.current = true;
      onPagesLoaded?.(locations.total + 1);
      if (lastCfiRef.current) {
        setPercent(locations.percentageFromCfi(lastCfiRef.current));
        savePage(filePath, locations.locationFromCfi(lastCfiRef.current)).catch(console.error);
      }
    })().catch((e) => {
      if (!cancelled) setError(String(e));
    });

    return () => {
      cancelled = true;
      bookRef.current?.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [data, filePath, onLastPage, onPagesLoaded]);

  useEffect(() => {
    setWindowTitle(basename(filePath));
  }, [filePath]);

  // Font size is a global reading preference (persisted in .settings.dat): load
  // the saved size on mount, then write through on change.
  useEffect(() => {
    (async () => {
      setFontPct(await getEpubFontSize());
      fontLoadedRef.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!fontLoadedRef.current) return;
    saveEpubFontSize(fontPct).catch(console.error);
  }, [fontPct]);

  // Apply theme + font size together so switching one never drops the other.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    rendition.themes.register(EPUB_THEME_NAME, buildThemeStyles());
    rendition.themes.select(EPUB_THEME_NAME);
    rendition.themes.fontSize(`${fontPct}%`);
  }, [theme, fontPct, ready]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const rendition = renditionRef.current;
      const book = bookRef.current;
      if (!rendition || !book) return;
      switch (e.key) {
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          rendition.prev();
          break;
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          rendition.next();
          break;
        case "Home": {
          e.preventDefault();
          const first = book.spine.first();
          if (first) rendition.display(first.href);
          break;
        }
        case "End": {
          e.preventDefault();
          const last = book.spine.last();
          if (last) rendition.display(last.href);
          break;
        }
        case "+":
        case "=":
          setFontPct((f) => Math.min(f + FONT_STEP, FONT_MAX));
          break;
        case "-":
        case "_":
          setFontPct((f) => Math.max(f - FONT_STEP, FONT_MIN));
          break;
        case "i":
        case "I":
          setShowInfo((v) => {
            const next = !v;
            setShowOverlay(next);
            return next;
          });
          break;
        case "t":
        case "T":
          setShowToc((v) => !v);
          break;
        case "p":
        case "P":
          setPinPageIndicator((v) => !v);
          break;
        case "f":
        case "F": {
          const win = getCurrentWindow();
          win.isFullscreen().then((fs) => win.setFullscreen(!fs)).catch(console.error);
          break;
        }
        case "x":
        case "X":
          getCurrentWindow().close().catch(console.error);
          break;
        case "Escape":
          if (showToc) setShowToc(false);
          else {
            setWindowTitle();
            onClose();
          }
          break;
      }
    },
    [onClose, showToc, setShowOverlay, setPinPageIndicator],
  );

  // Register on window AND on the rendition: when focus is inside the book's
  // iframe, window never sees the key — epubjs re-emits it through the rendition.
  useEffect(() => {
    if (!ready) return;
    const rendition = renditionRef.current;
    window.addEventListener("keydown", handleKey);
    rendition?.on("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      rendition?.off("keydown", handleKey);
    };
  }, [handleKey, ready]);

  const goTo = (href: string) => {
    renditionRef.current?.display(resolveHref(navBaseRef.current, href));
    setShowToc(false);
  };

  const renderToc = (items: TocItem[], depth = 0): React.ReactNode =>
    items.map((it, i) => (
      <div key={`${it.href}-${depth}-${i}`}>
        <button
          onClick={() => goTo(it.href)}
          className="w-full text-left px-3 py-1.5 rounded hover:bg-[var(--bg-tab-active)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors truncate"
          style={{ paddingLeft: `${12 + depth * 14}px` }}
        >
          {it.label.trim()}
        </button>
        {it.subitems && it.subitems.length > 0 && renderToc(it.subitems, depth + 1)}
      </div>
    ));

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] gap-4 px-6 text-center">
        <p>{t("errors.epubLoad")}</p>
        <p className="text-sm text-[var(--text-secondary)] font-mono break-all">{error}</p>
        <button
          onClick={() => { setWindowTitle(); onClose(); }}
          className="px-4 py-2 rounded-lg font-medium transition-all duration-200 hover:shadow-[0_0_20px_var(--glow)]"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          {t("errors.goBack")}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--bg-primary)]">
      <div ref={containerRef} className="flex-1 min-h-0" />

      {!ready && (
        <div className="fixed inset-0 flex items-center justify-center bg-[var(--bg-primary)]">
          <div className="w-10 h-10 border-4 border-[var(--border-spinner)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Table of contents panel */}
      {showToc && (
        <div className="fixed inset-y-0 left-0 w-72 max-w-[80vw] bg-[var(--bg-nav)] border-r border-[var(--border-nav)] shadow-2xl flex flex-col z-10">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-nav)]">
            <span className="font-display font-semibold text-[var(--text-primary)]">{t("reader.toc")}</span>
            <button onClick={() => setShowToc(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2">✕</button>
          </div>
          <div className="flex-1 overflow-auto py-2 text-sm">
            {toc.length > 0 ? renderToc(toc) : <p className="px-3 text-[var(--text-secondary)]">{t("reader.tocEmpty")}</p>}
          </div>
        </div>
      )}

      {/* Top-right shortcuts hint */}
      <div
        className="fixed top-4 right-4 text-sm px-3 py-2 rounded select-none"
        style={{
          background: "var(--bg-overlay)",
          color: "var(--text-overlay)",
          opacity: showInfo || showOverlay ? 0.3 : 0,
          transition: "opacity 0.3s ease",
          pointerEvents: showInfo || showOverlay ? "auto" : "none",
        }}
      >
        {showInfo ? (
          <table style={{ borderSpacing: "0 2px", borderCollapse: "separate" }}>
            <tbody>
              {[
                ["← / →", t("shortcuts.prevNext")],
                ["Home / End", t("shortcuts.firstLast")],
                ["+ / −", t("shortcuts.fontSize")],
                ["T", t("shortcuts.toc")],
                ["P", t("shortcuts.pin")],
                ["I", t("shortcuts.showHide")],
                ["F", t("shortcuts.fullscreen")],
                ["Escape", t("shortcuts.closeReader")],
                ["X", t("shortcuts.closeWindow")],
              ].map(([key, desc]) => (
                <tr key={key}>
                  <td className="pr-3 text-right font-mono text-[var(--text-key)] whitespace-nowrap">{key}</td>
                  <td className="text-[var(--text-overlay)] whitespace-nowrap">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <span className="font-mono">{t("shortcuts.hint")}</span>
        )}
      </div>

      {/* Bottom-right chapter + progress */}
      <div
        className="fixed bottom-4 right-4 text-sm px-3 py-2 rounded select-none text-right"
        style={{
          background: "var(--bg-overlay)",
          color: "var(--text-overlay)",
          opacity: showInfo || showOverlay || pinPageIndicator ? 0.3 : 0,
          transition: "opacity 0.3s ease",
          pointerEvents: showInfo || showOverlay || pinPageIndicator ? "auto" : "none",
        }}
      >
        {showInfo && <div>{t("shortcuts.fontSize")}: {fontPct}%</div>}
        {chapter && <div className="max-w-[40vw] truncate">{chapter}</div>}
        <div>{percent == null ? "…" : `${Math.round(percent * 100)}%`}</div>
      </div>
    </div>
  );
}
