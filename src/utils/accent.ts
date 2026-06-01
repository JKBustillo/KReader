export type AccentId = "ice" | "violet";

const STORAGE_KEY = "kreader-accent";
const DEFAULT_ACCENT: AccentId = "ice";
const VALID_ACCENTS: readonly AccentId[] = ["ice", "violet"];

export function getAccent(): AccentId {
  const stored = localStorage.getItem(STORAGE_KEY) as AccentId | null;
  return stored && VALID_ACCENTS.includes(stored) ? stored : DEFAULT_ACCENT;
}

export function applyAccent(accent: AccentId): void {
  document.documentElement.setAttribute("data-accent", accent);
  localStorage.setItem(STORAGE_KEY, accent);
}
