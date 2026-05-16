export const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"] as const;

export type LoaderResult = {
  pages: string[];
  pageNames?: string[];
  startPage?: number;
};
