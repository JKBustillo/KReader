import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { readFile, writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import * as pdfjsLib from "pdfjs-dist";
import PDFWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { detectKind } from "../loaders";
import type { LibraryEntry } from "../types/library";

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFWorkerUrl;

// Parses the binary layout shared by extract_cbz_cover and extract_cbr_cover:
//   u32 LE count | u8 mimeLen | mime bytes | u32 LE dataLen | image bytes
function parseCoverResponse(buffer: ArrayBuffer): Blob | null {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  let offset = 0;
  const count = view.getUint32(offset, true);
  offset += 4;
  if (count === 0) return null;
  const mimeLen = view.getUint8(offset);
  offset += 1;
  const mime = decoder.decode(new Uint8Array(buffer, offset, mimeLen));
  offset += mimeLen;
  const dataLen = view.getUint32(offset, true);
  offset += 4;
  return new Blob([new Uint8Array(buffer, offset, dataLen)], { type: mime });
}

const THUMBNAIL_SCALE = 0.25;
const THUMBNAIL_JPEG_QUALITY = 0.85;
const THUMBNAIL_MAX_WIDTH = 280;
const THUMBNAIL_MAX_HEIGHT = 420;
const THUMBNAIL_CACHE_SUBDIR = "kreader-thumbnails";
const MAX_CONCURRENT = 4;

// --- In-memory cache (deduplicates concurrent requests per session) ---
const cache = new Map<string, Promise<string | null>>();

// --- Semaphore ---
let running = 0;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot(): void {
  const next = queue.shift();
  if (next) {
    next();
  } else {
    running--;
  }
}

// --- Disk cache ---
// Initialized lazily on first use; dir is created once.
let cacheDirPromise: Promise<string> | null = null;

function getCacheDir(): Promise<string> {
  if (!cacheDirPromise) {
    cacheDirPromise = (async () => {
      const base = await appCacheDir();
      const dir = await join(base, THUMBNAIL_CACHE_SUBDIR);
      await mkdir(dir, { recursive: true }).catch(() => {});
      return dir;
    })();
  }
  return cacheDirPromise;
}

async function getDiskCachePath(entryId: string): Promise<string> {
  const dir = await getCacheDir();
  // entryId format: "filename::sizeBytes" — replace "::" to keep a valid filename
  const safeName = entryId.replace(/::/g, "__") + ".jpg";
  return join(dir, safeName);
}

async function loadFromDiskCache(entryId: string): Promise<string | null> {
  try {
    const filePath = await getDiskCachePath(entryId);
    if (!(await exists(filePath))) return null;
    const data = await readFile(filePath);
    return URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
  } catch {
    return null;
  }
}

async function saveToDiskCache(entryId: string, blob: Blob): Promise<void> {
  const filePath = await getDiskCachePath(entryId);
  const buffer = await blob.arrayBuffer();
  await writeFile(filePath, new Uint8Array(buffer));
}

// --- Image resize ---
// Scales the image down to fit within THUMBNAIL_MAX_WIDTH × THUMBNAIL_MAX_HEIGHT
// and re-encodes as JPEG. If already smaller, just re-encodes without upscaling.
function resizeBlob(blob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(THUMBNAIL_MAX_WIDTH / img.width, THUMBNAIL_MAX_HEIGHT / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, "image/jpeg", THUMBNAIL_JPEG_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// --- Cover extractors (return Blob | null) ---

async function getCbzCover(path: string): Promise<Blob | null> {
  const buffer = await invoke<ArrayBuffer>("extract_cbz_cover", { path });
  return parseCoverResponse(buffer);
}

async function getCbrCover(path: string): Promise<Blob | null> {
  const buffer = await invoke<ArrayBuffer>("extract_cbr_cover", { path });
  return parseCoverResponse(buffer);
}

async function getPdfCover(path: string): Promise<Blob | null> {
  const data = await readFile(path);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", THUMBNAIL_JPEG_QUALITY);
    });
  } finally {
    doc.destroy();
  }
}

async function getImageCover(path: string): Promise<Blob | null> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
  };
  const data = await readFile(path);
  return new Blob([data], { type: mimeMap[ext] ?? "image/jpeg" });
}

// --- Main generator ---

async function generate(entry: LibraryEntry): Promise<string | null> {
  await acquireSlot();
  try {
    // Fast path: disk cache hit — no file parsing needed.
    const cached = await loadFromDiskCache(entry.id);
    if (cached) return cached;

    const kind = detectKind(entry.currentPath);
    let cover: Blob | null = null;
    switch (kind) {
      case "cbz":   cover = await getCbzCover(entry.currentPath);   break;
      case "cbr":   cover = await getCbrCover(entry.currentPath);   break;
      case "pdf":   cover = await getPdfCover(entry.currentPath);   break;
      case "image": cover = await getImageCover(entry.currentPath); break;
      default: return null;
    }
    if (!cover) return null;

    const resized = (await resizeBlob(cover)) ?? cover;
    // Save to disk in the background — never blocks blob URL delivery.
    saveToDiskCache(entry.id, resized).catch(() => {});
    return URL.createObjectURL(resized);
  } catch {
    return null;
  } finally {
    releaseSlot();
  }
}

// --- Public API ---

export function getThumbnail(entry: LibraryEntry): Promise<string | null> {
  const hit = cache.get(entry.id);
  if (hit) return hit;
  const promise = generate(entry);
  cache.set(entry.id, promise);
  return promise;
}

export function removeThumbnailFromCache(id: string): void {
  cache.delete(id);
}

export function clearThumbnailCache(): void {
  cache.clear();
}
