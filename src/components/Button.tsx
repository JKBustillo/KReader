import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "sm" | "lg";

// Shared action-button language. `primary` is the signature accent CTA — a
// solid accent fill that picks up a colored glow on hover; `secondary`/`danger`
// lean on theme CSS variables so they track light/dark automatically. Layout/
// typography stay out of BASE_CLASS so SIZE_CLASS can own them without Tailwind
// utility conflicts.
const BASE_CLASS =
  "inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-ink)] shadow-md hover:shadow-[0_0_28px_var(--glow)] hover:-translate-y-0.5",
  secondary: "hover:bg-[var(--bg-tab-active)]",
  danger: "text-white hover:brightness-110 hover:-translate-y-px hover:shadow-lg",
};

const VARIANT_STYLE: Record<ButtonVariant, CSSProperties> = {
  primary: {},
  secondary: { color: "var(--text-primary)", border: "1px solid var(--border-nav)" },
  danger: { background: "var(--color-danger)" },
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs rounded",
  lg: "px-6 py-3 text-sm rounded-lg",
};

function Button({
  variant = "secondary",
  size = "sm",
  className = "",
  style,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`${BASE_CLASS} ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className}`.trim()}
      style={{ ...VARIANT_STYLE[variant], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;
