import { useEffect, useRef, type ReactNode } from "react";

const PANEL_BASE = "w-full rounded-2xl shadow-2xl p-5 flex flex-col gap-4";
const BACKDROP_COLOR = "rgba(0,0,0,0.62)";

/**
 * Centered modal shell: dimmed backdrop, Escape-to-close, click-outside-to-close,
 * and click-inside guarded with stopPropagation. Callers provide the panel content
 * as children and optionally a width via `panelClassName` (e.g. "max-w-sm").
 */
function Modal({
  onClose,
  panelClassName = "max-w-md",
  children,
}: {
  onClose: () => void;
  panelClassName?: string;
  children: ReactNode;
}) {
  // Keep the latest onClose in a ref so the keydown listener is registered once
  // (on mount) and never re-subscribes — re-subscribing on every parent render
  // races with other document keydown listeners and can drop the Escape event.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ background: BACKDROP_COLOR }}
      onClick={onClose}
    >
      <div
        className={`${PANEL_BASE} ${panelClassName}`}
        style={{ background: "var(--bg-nav)", border: "1px solid var(--border-nav)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default Modal;
