import { readDir } from "@tauri-apps/plugin-fs";
import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { IMAGE_EXTS_SET, extOf, type LoaderResult } from "./types";
import { basename } from "../utils/folderUtils";

export async function loadImageFolder(path: string): Promise<LoaderResult> {
  const dir = await dirname(path);
  const entries = await readDir(dir);

  const imageNames = entries
    .map((f) => f.name)
    .filter((name): name is string => !!name && IMAGE_EXTS_SET.has(extOf(name)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const imagePaths = await Promise.all(imageNames.map((name) => join(dir, name)));

  // Served from disk by the asset protocol: the WebView only decodes the pages
  // it actually shows, instead of buffering the whole folder up front.
  const pages = imagePaths.map((imgPath) => convertFileSrc(imgPath));

  const fileName = basename(path);
  const imgIndex = imageNames.indexOf(fileName);

  return {
    pages,
    pageNames: imageNames,
    startPage: imgIndex >= 0 ? imgIndex : 0,
  };
}
