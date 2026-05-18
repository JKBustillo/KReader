export type TagCategory = "author" | "circle" | "language" | "generic";

export type Tag = {
  type: "auto" | "custom";
  value: string;
  category?: TagCategory;
};

export type Library = {
  id: string;
  name: string;
  rootPath: string;
};

export type LibraryEntry = {
  id: string;
  libraryId: string;
  currentPath: string;
  filename: string;
  sizeBytes: number;
  modifiedAt: number;
  autoTags: Tag[];
  customTags: Tag[];
  isFavorite: boolean;
  addedAt: number;
  lastReadPage?: number;
  totalPages?: number;
};

export type SortField = "name" | "size" | "date" | "folder";
export type SortDirection = "asc" | "desc";
export type ViewMode = "details" | "grid";
