import { useEffect, useRef, useState } from "react";

// User-chosen tag colors (deliberately outside the theme tokens — these are
// content swatches, not chrome).
const PALETTE: string[] = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#8b5cf6", "#ec4899", "#94a3b8", "#a16207",
];

function ColorSwatch({
  color,
  onChange,
}: {
  color: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-3.5 h-3.5 rounded-full border"
        style={{
          background: color ?? "var(--text-muted)",
          borderColor: "var(--border-nav)",
        }}
        aria-label="Pick color"
      />
      {open && (
        <div
          className="absolute left-0 top-5 z-50 p-1.5 rounded shadow-lg grid gap-1"
          style={{
            background: "var(--bg-nav)",
            border: "1px solid var(--border-nav)",
            gridTemplateColumns: "repeat(5, 1fr)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => { onChange(hex); setOpen(false); }}
              className="w-5 h-5 rounded-full hover:scale-110 transition-transform"
              style={{ background: hex }}
            />
          ))}
          <button
            type="button"
            onClick={() => { onChange(undefined); setOpen(false); }}
            className="w-5 h-5 rounded-full border text-[10px] flex items-center justify-center hover:scale-110 transition-transform col-span-5"
            style={{
              borderColor: "var(--border-nav)",
              color: "var(--text-muted)",
              background: "transparent",
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default ColorSwatch;
