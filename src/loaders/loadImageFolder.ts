import { readFile, readDir } from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";
import { IMAGE_EXTS_SET, extOf, mimeForExt, type LoaderResult } from "./types";
import { basename } from "../utils/folderUtils";

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
      const blob = new Blob([data], { type: mimeForExt(extOf(imgPath)) });
      return URL.createObjectURL(blob);
    })
  );

  const fileName = basename(path);
  const imgIndex = imageNames.indexOf(fileName);

  return {
    pages,
    pageNames: imageNames,
    startPage: imgIndex >= 0 ? imgIndex : 0,
  };
}
