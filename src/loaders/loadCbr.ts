import { invoke } from "@tauri-apps/api/core";
import type { LoaderResult } from "./types";

// Mirrors the binary layout produced by the Rust extract_cbr command:
//   u32 LE  count
//   for each page:
//     u8       mime_len
//     [bytes]  mime (ASCII)
//     u32 LE   data_len
//     [bytes]  image data
export async function loadCbr(path: string): Promise<LoaderResult> {
  const buffer = await invoke<ArrayBuffer>("extract_cbr", { path });
  const view = new DataView(buffer);
  const decoder = new TextDecoder();

  let offset = 0;
  const count = view.getUint32(offset, true);
  offset += 4;

  const pages: string[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const mimeLen = view.getUint8(offset);
    offset += 1;
    const mime = decoder.decode(new Uint8Array(buffer, offset, mimeLen));
    offset += mimeLen;
    const dataLen = view.getUint32(offset, true);
    offset += 4;
    const blob = new Blob([new Uint8Array(buffer, offset, dataLen)], { type: mime });
    offset += dataLen;
    pages[i] = URL.createObjectURL(blob);
  }

  return { pages };
}
