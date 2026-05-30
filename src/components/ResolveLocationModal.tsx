import { useTranslation } from "react-i18next";
import type { LibraryEntry } from "../types/library";
import { normalizePath } from "../utils/folderUtils";
import Modal from "./Modal";

function ResolveLocationModal({
  entry,
  candidates,
  rootPath,
  onResolve,
  onClose,
}: {
  entry: LibraryEntry;
  candidates: string[];
  rootPath: string;
  onResolve: (entry: LibraryEntry, path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const normalizedRoot = normalizePath(rootPath);

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("library.resolveLocationTitle")}
        </h2>
        <button
          onClick={onClose}
          className="text-lg leading-none opacity-60 hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      </div>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {t("library.resolveLocationHint")}
      </p>
      <div className="flex flex-col gap-1">
        {candidates.map((path) => {
          const normalized = normalizePath(path);
          const display = normalized.startsWith(normalizedRoot + "/")
            ? normalized.slice(normalizedRoot.length + 1)
            : normalized;
          return (
            <button
              key={path}
              onClick={() => onResolve(entry, path)}
              className="text-left text-xs px-3 py-2 rounded transition-colors hover:bg-[var(--bg-tab-active)]"
              style={{
                color: "var(--text-primary)",
                border: "1px solid var(--border-nav)",
              }}
            >
              {display}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export default ResolveLocationModal;
