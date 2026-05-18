export function getRelativeFolder(entryPath: string, rootPath: string): string {
  const normalized = entryPath.replace(/\\/g, "/");
  const normalizedRoot = rootPath.replace(/\\/g, "/");
  const dir = normalized.substring(0, normalized.lastIndexOf("/"));
  if (dir === normalizedRoot) return "/";
  const rel = dir.startsWith(normalizedRoot + "/")
    ? dir.slice(normalizedRoot.length + 1)
    : dir;
  return rel || "/";
}
