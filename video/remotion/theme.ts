// Dark theme matching the app's palette (globals.css) so episodes look like the tool.
export const T = {
  bg: "#0c0e16",
  card: "#161a2a",
  cardBorder: "#232842",
  text: "#f4f5fa",
  muted: "#9aa0b8",
  muted2: "#6b7089",
  primary: "#6366f1",
  accent: "#22c55e",
  red: "#ef4444",
  blue: "#3b82f6",
  amber: "#f59e0b",
  font: "'Helvetica Neue', 'Arial', sans-serif",
} as const;

export const fmtEur = (v: number, digits = 0) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: digits }).format(v);

export const fmtPct = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
