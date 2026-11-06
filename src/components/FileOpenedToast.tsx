import { useEffect, useState } from "react";

const TOAST_DURATION_MS = 2500;

interface FileOpenedToastProps {
  name: string;
}

/**
 * Brief top-center notice with the name of the file just opened. Mount it keyed
 * by the file path so each newly opened file (e.g. via Ctrl+Arrow) shows it again.
 */
function FileOpenedToast({ name }: FileOpenedToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw] pointer-events-none">
      <div
        className="kr-pop px-4 py-2.5 rounded-xl shadow-2xl text-sm truncate"
        style={{ background: "var(--bg-nav)", border: "1px solid var(--border-nav)", color: "var(--text-primary)" }}
        title={name}
      >
        {name}
      </div>
    </div>
  );
}

export default FileOpenedToast;
