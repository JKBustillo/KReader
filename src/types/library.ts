export type TagCategory = "author" | "circle" | "language" | "generic";

export type ReadingState = "unread" | "in_progress" | "completed";

export type Tag = {
  type: "auto" | "custom";
  value: string;
  category?: TagCategory;
  color?: string;
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
  readingState: ReadingState;
  rating?: number;
  lastOpenedAt?: number;
  totalPages?: number;
};

export type SortField = "name" | "size" | "date" | "folder" | "lastOpened";
export type SortDirection = "asc" | "desc";
export type ViewMode = "details" | "grid";
