"use client";

import { useMemo, useState } from "react";
import type { DividendItem } from "@/lib/types";
import { formatMoney, prettyTicker } from "@/lib/analytics";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

interface DayPayments {
  total: number;
  items: DividendItem[];
}

export default function DividendCalendar({ items, currency }: { items: DividendItem[]; currency: string }) {
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() }); // m: 0-based

  const { byDay, monthTotal, monthCount } = useMemo(() => {
    const byDay = new Map<number, DayPayments>();
    let monthTotal = 0;
    let monthCount = 0;
    for (const d of items) {
      const paid = new Date(d.paidOn);
      if (paid.getFullYear() !== view.y || paid.getMonth() !== view.m) continue;
      const day = paid.getDate();
      const entry = byDay.get(day) ?? { total: 0, items: [] };
      entry.total += d.amount;
      entry.items.push(d);
      byDay.set(day, entry);
      monthTotal += d.amount;
      monthCount++;
    }
    return { byDay, monthTotal, monthCount };
  }, [items, view]);

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const firstWeekday = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Monday = 0
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isCurrentMonth = view.y === now.getFullYear() && view.m === now.getMonth();
  const monthName = new Date(view.y, view.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const shift = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const navBtn = "rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className={navBtn} aria-label="Previous month">←</button>
          <button onClick={() => shift(1)} className={navBtn} aria-label="Next month">→</button>
          {!isCurrentMonth && (
            <button onClick={() => setView({ y: now.getFullYear(), m: now.getMonth() })} className={navBtn}>
              Today
            </button>
          )}
          <span className="ml-1 text-sm font-semibold">{monthName}</span>
        </div>
        <span className="num text-sm text-muted">
          {monthCount > 0 ? (
            <>
              {monthCount} payment{monthCount === 1 ? "" : "s"} · <span className="font-semibold text-accent">{formatMoney(monthTotal, currency)}</span>
            </>
          ) : (
            "No payments this month"
          )}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-surface px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-2">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} className="min-h-24 bg-surface/60" />;
          const pays = byDay.get(day);
          const isToday = isCurrentMonth && day === now.getDate();
          return (
            <div key={day} className={`min-h-24 bg-card p-1.5 ${isToday ? "ring-1 ring-inset ring-[var(--accent)]" : ""}`}>
              <div className={`num mb-1 text-right text-[11px] ${isToday ? "font-bold text-accent" : "text-muted-2"}`}>{day}</div>
              {pays && (
                <div className="space-y-1">
                  {pays.items.slice(0, MAX_CHIPS).map((p, j) => (
                    <div
                      key={p.reference ?? j}
                      className="rounded-md bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] leading-tight"
                      title={`${p.ticker}: ${formatMoney(p.amount, currency)}`}
                    >
                      <div className="truncate font-medium text-foreground">{prettyTicker(p.ticker)}</div>
                      <div className="num text-accent">{formatMoney(p.amount, currency)}</div>
                    </div>
                  ))}
                  {pays.items.length > MAX_CHIPS && (
                    <div
                      className="px-1.5 text-[10px] text-muted-2"
                      title={pays.items
                        .slice(MAX_CHIPS)
                        .map((p) => `${prettyTicker(p.ticker)}: ${formatMoney(p.amount, currency)}`)
                        .join("\n")}
                    >
                      +{pays.items.length - MAX_CHIPS} more · {formatMoney(pays.total, currency)} total
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
