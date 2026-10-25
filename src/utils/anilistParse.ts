/**
 * Reads the AniList-relevant number out of a comic filename: a volume
 * ("Tomo 08", "Vol. 3", "v12", "Volumen 4"), a chapter ("Episode 37",
 * "Capítulo 12", "85-91" → 91, "Season 2 Ep. 3"), or an extra that must not
 * move AniList progress ("Epilogue 2", "Special Ep. 1", "Preview").
 */
export type ReadingUnit =
  | { kind: "volume"; n: number }
  | { kind: "chapter"; n: number; season?: number }
  | { kind: "extra" };

const EXTRA_RE = /^(?:epilogue|special|preview|extra|side\s*story|omake|prologue)\b/i;
const SEASON_RE = /\bseason\s*(\d+)\s*ep(?:isode)?\.?\s*(\d+(?:\.\d+)?)/i;
const CHAPTER_RE =
  /(?:\bepisode|\bep\.|\bchapter|\bcap[ií]tulo|\bcap\.|\bch\.|\bc(?=\d))\s*#?\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/i;
const VOLUME_RE = /(?:\btomo|\bvol(?:umen|ume)?\.?|\bv(?=\d))\s*#?\s*(\d+)/i;
// "KISS X SIS 85-91" / "GE 0-7" / "01 al 05ex": a bare range is a chapter span
// ("ex" = the scan bundles that range's extras).
const BARE_RANGE_RE = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:-|al|y)\s*(\d+(?:\.\d+)?)(?:ex)?\s*$/i;
// "KISS X SIS 116" / "36ex": a lone trailing number after the series name is a chapter.
const BARE_TRAILING_RE = /(?:^|\s)(\d+(?:\.\d+)?)(?:ex)?\s*$/i;
// Bracketed groups like "(2009) (Digital) [End]" would otherwise feed the bare patterns.
const BRACKETED_RE = /[([][^)\]]*[)\]]/g;
const EXTENSION_RE = /\.[^.]+$/;

// AniList progress is an integer; "Chapter 5.5" only proves chapter 5 is done.
const toProgress = (raw: string) => Math.floor(Number(raw));

export function parseReadingUnit(filename: string): ReadingUnit {
  const name = filename.replace(EXTENSION_RE, "").trim();
  if (EXTRA_RE.test(name)) return { kind: "extra" };

  const season = SEASON_RE.exec(name);
  if (season) return { kind: "chapter", n: toProgress(season[2]), season: Number(season[1]) };

  const chapter = CHAPTER_RE.exec(name);
  if (chapter) return { kind: "chapter", n: toProgress(chapter[2] ?? chapter[1]) };

  const volume = VOLUME_RE.exec(name);
  if (volume) return { kind: "volume", n: Number(volume[1]) };

  const bare = name.replace(BRACKETED_RE, "").trim();
  const range = BARE_RANGE_RE.exec(bare);
  if (range) return { kind: "chapter", n: toProgress(range[2]) };
  const trailing = BARE_TRAILING_RE.exec(bare);
  if (trailing) return { kind: "chapter", n: toProgress(trailing[1]) };

  return { kind: "extra" };
}

const FIRST_SEASON = 1;

/**
 * AniList numbers chapters continuously across seasons, while scans restart at
 * "Season 2 Ep. 1". Offsets a seasonal chapter by the highest chapter of every
 * earlier season present among the folder's files (unseasoned files = season 1).
 */
export function absoluteChapter(
  unit: Extract<ReadingUnit, { kind: "chapter" }>,
  siblingFilenames: string[],
): number {
  const season = unit.season ?? FIRST_SEASON;
  if (season === FIRST_SEASON) return unit.n;

  const maxBySeason = new Map<number, number>();
  for (const filename of siblingFilenames) {
    const sibling = parseReadingUnit(filename);
    if (sibling.kind !== "chapter") continue;
    const s = sibling.season ?? FIRST_SEASON;
    if (s < season) maxBySeason.set(s, Math.max(maxBySeason.get(s) ?? 0, sibling.n));
  }
  let offset = 0;
  for (const max of maxBySeason.values()) offset += max;
  return offset + unit.n;
}
