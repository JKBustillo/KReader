/** Small inline loading wheel in the accent color. */
function Spinner({ label }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block w-3.5 h-3.5 border-2 rounded-full animate-spin"
      style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
    />
  );
}

export default Spinner;
