export const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"] as const;

export const IMAGE_EXTS_SET: Set<string> = new Set(IMAGE_EXTS);

const DEFAULT_IMAGE_MIME = "image/jpeg";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

// Lowercased extension of a file name/path, without the dot ("" if none).
export function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

// MIME type for an image extension, falling back to JPEG for unknown ones.
export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext] ?? DEFAULT_IMAGE_MIME;
}

export type LoaderResult = {
  pages: string[];
  pageNames?: string[];
  startPage?: number;
};
