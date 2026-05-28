import { readFile } from "@tauri-apps/plugin-fs";
import JSZip from "jszip";
import { IMAGE_EXTS, type LoaderResult } from "./types";

// Derived from IMAGE_EXTS so supported formats stay in one place.
const CBZ_IMAGE_REGEX = new RegExp(`\\.(${IMAGE_EXTS.join("|")})$`, "i");

export async function loadCbz(path: string): Promise<LoaderResult> {
  const data = await readFile(path);
  const zip = await JSZip.loadAsync(data);

  const imageEntries = Object.values(zip.files)
    .filter((file) => !file.dir && CBZ_IMAGE_REGEX.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const pages = await Promise.all(
    imageEntries.map(async (file) => {
      const blob = await file.async("blob");
      return URL.createObjectURL(blob);
    })
  );

  return { pages };
}
