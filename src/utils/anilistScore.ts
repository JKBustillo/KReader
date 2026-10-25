import type { ScoreFormat } from "./anilistApi";

/**
 * KReader keeps scores as AniList's raw 0-100 value (0 = unscored) and only maps
 * them to the account's format for display, so a queued edit never depends on
 * which format was active when it was made.
 */
export const RAW_SCORE_MAX = 100;
export const NO_SCORE = 0;

export type ScoreChoice = { raw: number; label: string };

export type ScoreControl =
  | { kind: "choices"; choices: ScoreChoice[] }
  /** Free input of `raw / divisor`, from `step` up to RAW_SCORE_MAX / divisor. */
  | { kind: "number"; divisor: number; step: number };

const POINT_10_COUNT = 10;
const POINT_5_COUNT = 5;
const POINT_10_RAW_STEP = RAW_SCORE_MAX / POINT_10_COUNT;
const POINT_5_RAW_STEP = RAW_SCORE_MAX / POINT_5_COUNT;
const STAR = "★";
// Raw values AniList stores for its three smileys, and the lower bounds it uses to read them back.
const POINT_3_CHOICES: ScoreChoice[] = [
  { raw: 35, label: "☹" },
  { raw: 60, label: "😐" },
  { raw: 85, label: "🙂" },
];
const POINT_3_MIN_NEUTRAL = 36;
const POINT_3_MIN_HAPPY = 61;
const DECIMAL_DIVISOR = 10;
const DECIMAL_STEP = 0.1;

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

export function scoreControl(format: ScoreFormat): ScoreControl {
  switch (format) {
    case "POINT_100":
      return { kind: "number", divisor: 1, step: 1 };
    case "POINT_10_DECIMAL":
      return { kind: "number", divisor: DECIMAL_DIVISOR, step: DECIMAL_STEP };
    case "POINT_10":
      return { kind: "choices", choices: range(POINT_10_COUNT).map((n) => ({ raw: n * POINT_10_RAW_STEP, label: String(n) })) };
    case "POINT_5":
      return { kind: "choices", choices: range(POINT_5_COUNT).map((n) => ({ raw: n * POINT_5_RAW_STEP, label: STAR.repeat(n) })) };
    case "POINT_3":
      return { kind: "choices", choices: POINT_3_CHOICES };
  }
}

const snapToStep = (raw: number, step: number, count: number) =>
  Math.min(Math.max(Math.round(raw / step), 1), count) * step;

/**
 * The raw value of the choice that represents `raw` in a choices format (a 85
 * shows as 9/10 or 4 stars), so the matching button can be highlighted. Number
 * formats and NO_SCORE are returned as they are.
 */
export function choiceRawFor(raw: number, format: ScoreFormat): number {
  if (raw === NO_SCORE) return NO_SCORE;
  switch (format) {
    case "POINT_10":
      return snapToStep(raw, POINT_10_RAW_STEP, POINT_10_COUNT);
    case "POINT_5":
      return snapToStep(raw, POINT_5_RAW_STEP, POINT_5_COUNT);
    case "POINT_3":
      return raw >= POINT_3_MIN_HAPPY ? POINT_3_CHOICES[2].raw
        : raw >= POINT_3_MIN_NEUTRAL ? POINT_3_CHOICES[1].raw
        : POINT_3_CHOICES[0].raw;
    default:
      return raw;
  }
}

/** Raw value from a number-format input (e.g. 7.5 in POINT_10_DECIMAL -> 75), clamped to 0-100. */
export function rawFromInput(value: number, divisor: number): number {
  if (!Number.isFinite(value)) return NO_SCORE;
  return Math.min(Math.max(Math.round(value * divisor), NO_SCORE), RAW_SCORE_MAX);
}
