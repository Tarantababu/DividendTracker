"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, seriesColor, tooltipStyle } from "@/lib/chartTheme";
import type { MacroQuote } from "@/lib/marketData";
import type { StoryChart } from "@/app/api/digest/route";

/**
 * Two or three macro instruments overlaid to make a relationship visible.
 *
 * Everything is rebased to 100 at the start of the window: a bond yield trades
 * near 4 and the Nasdaq near 25,000, so plotting raw levels on one axis would
 * flatten one into a straight line. Rebasing compares SHAPE — do they move
 * together, or did they diverge? — which is the actual question.
 */
export default function StoryRelationChart({ chart, macro }: { chart: StoryChart; macro: MacroQuote[] }) {
  const bySymbol = useMemo(() => new Map(macro.map((m) => [m.symbol, m])), [macro]);
  const series = chart.symbols.map((s) => bySymbol.get(s)).filter((m): m is MacroQuote => !!m && m.history.length > 2);

  const data = useMemo(() => {
    if (series.length < 2) return [];
    // Align on the dates the first instrument has, then rebase each to 100.
    const base = series.map((m) => m.history[0]?.c || 1);
    const dates = series[0].history.map((h) => h.d);
    const lookup = series.map((m) => new Map(m.history.map((h) => [h.d, h.c])));
    return dates.map((d) => {
      const row: Record<string, string | number> = { d };
      series.forEach((m, i) => {
        const c = lookup[i].get(d);
        if (c != null && base[i]) row[m.symbol] = (c / base[i]) * 100;
      });
      return row;
    });
  }, [series]);

  if (data.length < 3) return null;

  return (
    <figure className="rounded-lg border border-border bg-surface/40 p-3">
      <figcaption className="mb-1 text-xs font-semibold">{chart.title}</figcaption>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((m, i) => (
          <span key={m.symbol} className="flex items-center gap-1.5 text-[10px] text-muted-2">
            <span className="h-0.5 w-3 rounded-full" style={{ background: seriesColor(i) }} />
            {m.name}
          </span>
        ))}
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="d" {...axisProps} minTickGap={44} tickFormatter={(d) => String(d).slice(2, 7)} />
            <YAxis {...axisProps} width={38} tickFormatter={(v) => `${Math.round(Number(v))}`} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, n) => {
                const m = bySymbol.get(String(n));
                // Rebased units mean nothing on their own; show the move since the
                // start of the window, which is what the reader is comparing.
                return [`${(Number(v) - 100 >= 0 ? "+" : "") + (Number(v) - 100).toFixed(1)}% over 1y`, m?.name ?? String(n)];
              }}
            />
            {series.map((m, i) => (
              <Line key={m.symbol} type="monotone" dataKey={m.symbol} stroke={seriesColor(i)} strokeWidth={1.8} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {chart.caption && <p className="mt-2 text-[11px] leading-relaxed text-muted">{chart.caption}</p>}
      <p className="mt-1 text-[10px] text-muted-2">Both rebased to 100 a year ago — compare the shapes, not the levels.</p>
    </figure>
  );
}
