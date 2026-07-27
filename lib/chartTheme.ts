// Shared Recharts styling. Every chart in the app pulls axis/grid/tooltip props
// and colours from here, so they read as one system instead of 16 dialects.
//
// Palette rule (precision fintech): categorical series are muted and similar in
// weight; PRIMARY is reserved for the series that matters on that chart, and
// GAIN/LOSS only ever encode direction of money.

export const CHART = {
  primary: "var(--primary)",
  gain: "var(--accent)",
  loss: "var(--red)",
  grid: "var(--border-soft)",
  axis: "var(--muted-2)",
  reference: "var(--border-strong)",
} as const;

/** Categorical series colours — deliberately even in weight so no slice shouts. */
export const CHART_SERIES = [
  "var(--primary)",
  "var(--blue)",
  "var(--teal)",
  "var(--amber)",
  "var(--violet)",
  "var(--pink)",
  "var(--accent)",
  "#64748b",
  "#a855f7",
  "#0ea5e9",
] as const;

/**
 * Identity colours for categories (donut slices, chips, per-category charts).
 * Deliberately NOT the generic series palette: --primary is near-black in this
 * theme and would read as "no colour", while --accent/--red carry gain/loss
 * meaning elsewhere and must not double as a category. These are evenly spaced
 * hues at similar lightness, so no slice dominates and adjacent ones stay
 * distinguishable.
 */
export const CATEGORY_SERIES = [
  "#4f46e5", // indigo
  "#0891b2", // cyan
  "#d97706", // amber
  "#7c3aed", // violet
  "#0d9488", // teal
  "#db2777", // pink
  "#2563eb", // blue
  "#65a30d", // olive
  "#a21caf", // fuchsia
  "#64748b", // slate
] as const;
export const categoryColor = (i: number) => CATEGORY_SERIES[i % CATEGORY_SERIES.length];

export const seriesColor = (i: number) => CHART_SERIES[i % CHART_SERIES.length];

/** Consistent axis ticks: small, quiet, tabular. */
export const axisTick = { fontSize: 11, fill: "var(--muted-2)" } as const;

export const axisProps = {
  tick: axisTick,
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = {
  stroke: CHART.grid,
  strokeDasharray: "3 3",
  vertical: false,
} as const;

/** One tooltip look everywhere. */
export const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--foreground)",
  fontSize: 12,
  boxShadow: "var(--sh-md)",
  padding: "8px 10px",
} as const;

export const tooltipProps = {
  contentStyle: tooltipStyle,
  labelStyle: { color: "var(--muted-2)", fontSize: 11, marginBottom: 2 },
  cursor: { stroke: "var(--border-strong)", strokeWidth: 1 },
} as const;

/** Tooltip cursor for bar/column charts (a translucent band, not a line). */
export const barCursor = { fill: "var(--primary-dim)" } as const;
