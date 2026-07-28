// Dark counterpart of the app's Fintech-kit palette, so episodes look like the
// tool on screen: the kit's own sidebar black as the canvas, its greens/reds for
// direction, and the same restrained categorical hues used in the charts.
export const T = {
  bg: "#0d0d12", // the kit's sidebar black
  card: "#161821",
  cardBorder: "#242733",
  text: "#ffffff",
  muted: "#a8adba",
  muted2: "#7c8290",
  primary: "#4f46e5",
  accent: "#16a34a",
  red: "#dc2626",
  blue: "#3b82f6",
  amber: "#d97706",
  teal: "#0d9488",
  violet: "#7c3aed",
  font: "'Helvetica Neue', 'Arial', sans-serif",
} as const;

/** Category identity colours — same scale the app uses, so a category looks the
 *  same in the video as on the dashboard. */
export const CATEGORY_COLORS = ["#4f46e5", "#0891b2", "#d97706", "#7c3aed", "#0d9488", "#db2777", "#2563eb", "#65a30d"] as const;

export const fmtEur = (v: number, digits = 0) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: digits }).format(v);

export const fmtPct = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
