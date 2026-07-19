"use client";

import { useState } from "react";
import type { DividendItem } from "@/lib/types";
import { formatMoney, prettyTicker } from "@/lib/analytics";

const PAGE = 15;

export default function DividendHistory({ items, currency }: { items: DividendItem[]; currency: string }) {
  const [shown, setShown] = useState(PAGE);
  const visible = items.slice(0, shown);

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            {["Paid on", "Holding", "Shares", "Per share", "Amount"].map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-2 ${i < 2 ? "text-left" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((d, i) => (
            <tr key={d.reference ?? i} className="border-b border-border-soft transition-colors hover:bg-card-hover">
              <td className="num px-3 py-2 text-muted">
                {new Date(d.paidOn).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </td>
              <td className="px-3 py-2 font-medium">{prettyTicker(d.ticker)}</td>
              <td className="num px-3 py-2 text-right text-muted">{d.quantity?.toLocaleString("en-GB", { maximumFractionDigits: 4 })}</td>
              <td className="num px-3 py-2 text-right text-muted">
                {d.grossAmountPerShare != null ? d.grossAmountPerShare.toLocaleString("en-GB", { maximumFractionDigits: 4 }) : "—"}
              </td>
              <td className="num px-3 py-2 text-right font-medium text-accent">{formatMoney(d.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown < items.length && (
        <button
          onClick={() => setShown((s) => s + PAGE * 2)}
          className="mt-3 w-full rounded-xl border border-border py-2 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground"
        >
          Show more ({items.length - shown} remaining)
        </button>
      )}
    </div>
  );
}
