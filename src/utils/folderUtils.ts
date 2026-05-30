/** Last path segment, handling both `/` and `\` separators. */
export function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? "";
}

/** Convert Windows backslashes to forward slashes for consistent comparisons. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function getRelativeFolder(entryPath: string, rootPath: string): string {
  const normalized = normalizePath(entryPath);
  const normalizedRoot = normalizePath(rootPath);
  const dir = normalized.substring(0, normalized.lastIndexOf("/"));
  if (dir === normalizedRoot) return "/";
  const rel = dir.startsWith(normalizedRoot + "/")
    ? dir.slice(normalizedRoot.length + 1)
    : dir;
  return rel || "/";
}
