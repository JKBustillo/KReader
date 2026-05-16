import { readFile, readDir } from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";
import { IMAGE_EXTS, type LoaderResult } from "./types";

const IMAGE_EXTS_SET: Set<string> = new Set(IMAGE_EXTS);

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

export async function loadImageFolder(path: string): Promise<LoaderResult> {
  const dir = await dirname(path);
  const entries = await readDir(dir);

  const imageNames = entries
    .map((f) => f.name)
    .filter((name): name is string => !!name && IMAGE_EXTS_SET.has(extOf(name)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const imagePaths = await Promise.all(imageNames.map((name) => join(dir, name)));

  const pages = await Promise.all(
    imagePaths.map(async (imgPath) => {
      const data = await readFile(imgPath);
      const blob = new Blob([data], { type: MIME_BY_EXT[extOf(imgPath)] ?? "image/jpeg" });
      return URL.createObjectURL(blob);
    })
  );

  const fileName = path.split(/[/\\]/).pop()!;
  const imgIndex = imageNames.indexOf(fileName);

  return {
    pages,
    pageNames: imageNames,
    startPage: imgIndex >= 0 ? imgIndex : 0,
  };
}
