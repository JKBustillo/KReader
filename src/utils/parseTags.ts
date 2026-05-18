import type { Tag } from "../types/library";

const LANGUAGE_MAP: Record<string, string> = {
  en: "English", english: "English",
  es: "Spanish", spanish: "Spanish",
  jp: "Japanese", japanese: "Japanese",
  fr: "French", french: "French",
  zh: "Chinese", chinese: "Chinese",
  ko: "Korean", korean: "Korean",
  it: "Italian", italian: "Italian",
  de: "German", german: "German",
  pt: "Portuguese", portuguese: "Portuguese",
  ru: "Russian", russian: "Russian",
};

const NON_CREATOR_BRACKETS = new Set([
  "digital", "dl", "hq", "decensored", "uncensored",
  "complete", "color", "coloured", "colored", "ongoing",
  "x3200", "x2400", "x2048",
]);

const BRACKET_RE = /\[([^\]]+)\]/g;
const CREATOR_WITH_AUTHOR_RE = /^(.+?)\s*\((.+?)\)$/;

export function parseAutoTags(filename: string): Tag[] {
  const name = filename.replace(/\.[^.]+$/, "");
  const tags: Tag[] = [];
  let isFirst = true;

  for (const match of name.matchAll(BRACKET_RE)) {
    const content = match[1].trim();
    const lower = content.toLowerCase();

    const language = LANGUAGE_MAP[lower];
    if (language) {
      tags.push({ type: "auto", value: language, category: "language" });
      isFirst = false;
      continue;
    }

    const creatorMatch = CREATOR_WITH_AUTHOR_RE.exec(content);
    if (creatorMatch) {
      tags.push({ type: "auto", value: creatorMatch[1].trim(), category: "circle" });
      tags.push({ type: "auto", value: creatorMatch[2].trim(), category: "author" });
      isFirst = false;
      continue;
    }

    if (isFirst && !NON_CREATOR_BRACKETS.has(lower) && !/\d/.test(content)) {
      tags.push({ type: "auto", value: content, category: "circle" });
    }

    isFirst = false;
  }

  return tags;
}
