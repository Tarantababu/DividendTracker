import { NextResponse } from "next/server";
import { syncDividends, syncOrders, syncTransactions, T212Error } from "@/lib/t212";
import { prettyTicker } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export type EventKind = "dividend" | "deposit" | "withdrawal" | "buy" | "sell";

export interface PortfolioEvent {
  date: string; // YYYY-MM-DD
  kind: EventKind;
  label: string;
  amount: number; // account currency
}

export async function GET() {
  const events: PortfolioEvent[] = [];
  const notes: string[] = [];

  // Dividends — from the existing local cache
  try {
    const dividends = await syncDividends(false);
    for (const d of dividends.items) {
      events.push({ date: d.paidOn.slice(0, 10), kind: "dividend", label: `${prettyTicker(d.ticker)} dividend`, amount: d.amount });
    }
  } catch (err) {
    notes.push(`dividends unavailable (${err instanceof T212Error ? err.code : "error"})`);
  }

  // Cash movements — deposits and withdrawals only; interest/fees are noise here
  try {
    const tx = await syncTransactions(false);
    for (const t of tx.items) {
      if (/^DEPOSIT/i.test(t.type)) {
        events.push({ date: t.dateTime.slice(0, 10), kind: "deposit", label: "Deposit", amount: Math.abs(t.amount) });
      } else if (/^WITHDRAW/i.test(t.type)) {
        events.push({ date: t.dateTime.slice(0, 10), kind: "withdrawal", label: "Withdrawal", amount: -Math.abs(t.amount) });
      } else if (t.type === "TRANSFER") {
        // Signed: + into this account, - out of it
        events.push({
          date: t.dateTime.slice(0, 10),
          kind: t.amount >= 0 ? "deposit" : "withdrawal",
          label: t.amount >= 0 ? "Transfer in" : "Transfer out",
          amount: t.amount,
        });
      }
    }
  } catch (err) {
    notes.push(`deposits/withdrawals unavailable (${err instanceof T212Error ? err.code : "error"})`);
  }

  // Order executions — one event per fill
  try {
    const orders = await syncOrders(false);
    for (const o of orders.items) {
      if (o.order.status !== "FILLED" && o.order.status !== "PARTIALLY_FILLED") continue;
      if (!o.fill?.filledAt) continue;
      const amount = Math.abs(o.fill.walletImpact?.netValue ?? o.fill.quantity * o.fill.price);
      events.push({
        date: o.fill.filledAt.slice(0, 10),
        kind: o.order.side === "SELL" ? "sell" : "buy",
        label: `${o.order.side === "SELL" ? "Sold" : "Bought"} ${prettyTicker(o.order.ticker)}`,
        amount,
      });
    }
  } catch (err) {
    notes.push(`trades unavailable (${err instanceof T212Error ? err.code : "error"})`);
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return NextResponse.json({ events, notes });
}
