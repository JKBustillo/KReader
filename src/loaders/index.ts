import { loadCbz } from "./loadCbz";
import { loadCbr } from "./loadCbr";
import { loadImageFolder } from "./loadImageFolder";
import { IMAGE_EXTS, type LoaderResult } from "./types";

export { IMAGE_EXTS };
export type { LoaderResult };

export type FileKind = "cbz" | "cbr" | "pdf" | "image" | "unsupported";

const IMAGE_EXTS_SET: Set<string> = new Set(IMAGE_EXTS);

export function detectKind(path: string): FileKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "cbz" || ext === "zip") return "cbz";
  if (ext === "cbr" || ext === "rar") return "cbr";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTS_SET.has(ext)) return "image";
  return "unsupported";
}

// PDF is intentionally not handled here: it returns raw bytes to PDFReader
// instead of a pages array, so callers must branch on detectKind first.
export async function loadPages(path: string): Promise<LoaderResult> {
  const kind = detectKind(path);
  switch (kind) {
    case "cbz": return loadCbz(path);
    case "cbr": return loadCbr(path);
    case "image": return loadImageFolder(path);
    case "pdf": throw new Error("PDF must be handled separately by the caller");
    default: throw new Error(`Unsupported format: ${path}`);
  }
}
