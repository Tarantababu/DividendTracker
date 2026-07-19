import { NextResponse } from "next/server";
import { getAccountSummary, syncDividends, syncTransactions, T212Error } from "@/lib/t212";
import { contributionStats, externalCashflows, xirr } from "@/lib/fire";
import { readBankCache } from "@/lib/bank";
import { normalize, summarize } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export interface FireBudget {
  monthlyExpenses: number; // real trailing N26 spend
  monthlyNet: number; // real trailing amount saved (income - spend)
  savingsRate: number;
}

export interface FirePayload {
  currency: string;
  totalValue: number;
  netContributions: number;
  growth: number; // totalValue - netContributions (all-time earnings incl. dividends & interest)
  xirrPct: number | null; // money-weighted annual return
  monthlyContribution12m: number; // avg net contribution over trailing 12 months
  dividends12m: number;
  dividendsMonthly12m: number;
  firstFlowDate: string | null;
  budget: FireBudget | null; // real N26 numbers when the budget is connected
  fetchedAt: string;
}

/** Pull real expenses/savings from the N26 budget cache if it's connected. */
async function loadBudget(): Promise<FireBudget | null> {
  try {
    const cache = await readBankCache();
    if (!cache) return null;
    const s = summarize(normalize(cache.transactions));
    if (s.avgIncome <= 0 && s.avgExpenses <= 0) return null;
    return { monthlyExpenses: s.avgExpenses, monthlyNet: s.avgNet, savingsRate: s.savingsRate };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const [summary, tx, dividends, budget] = await Promise.all([getAccountSummary(), syncTransactions(false), syncDividends(false), loadBudget()]);

    const flows = externalCashflows(tx.items);
    const stats = contributionStats(flows);
    const rate = xirr(flows, summary.totalValue);

    const divCutoff = Date.now() - 365.25 * 86400_000;
    const dividends12m = dividends.items.filter((d) => Date.parse(d.paidOn) >= divCutoff).reduce((sum, d) => sum + d.amount, 0);

    const payload: FirePayload = {
      currency: summary.currency ?? "EUR",
      totalValue: summary.totalValue,
      netContributions: stats.netContributions,
      growth: summary.totalValue - stats.netContributions,
      xirrPct: rate === null ? null : rate * 100,
      monthlyContribution12m: stats.monthlyAvg12m,
      dividends12m,
      dividendsMonthly12m: dividends12m / 12,
      firstFlowDate: stats.firstFlowDate,
      budget,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
