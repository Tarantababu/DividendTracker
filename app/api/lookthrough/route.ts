import { NextResponse } from "next/server";
import { getAccountSummary, getPositions, T212Error } from "@/lib/t212";
import { prettyTicker } from "@/lib/analytics";
import { fetchFundInfo, resolveSymbol } from "@/lib/yahooFund";
import type { LookThroughResult, LookThroughStock } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TTL_MS = 30 * 60 * 1000;

interface Agg {
  name: string;
  value: number;
  direct: boolean;
  funds: Set<string>;
}

export async function GET() {
  const store = globalThis as Record<string, unknown>;
  const cached = store.__lookthrough as { at: number; payload: LookThroughResult } | undefined;
  if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.payload);

  try {
    const [summary, positions] = await Promise.all([getAccountSummary(), getPositions()]);
    const currency = summary.currency ?? "EUR";
    const total = positions.reduce((sum, p) => sum + p.walletImpact.currentValue, 0);

    const agg = new Map<string, Agg>();
    const unresolved: string[] = [];
    let otherValue = 0; // ETF exposure beyond the top-10 (real, but not individually visible)
    let unclassifiedValue = 0; // positions we could not look through at all
    let resolvedEtfs = 0;

    const add = (key: string, name: string, value: number, opts: { direct?: boolean; fund?: string }) => {
      const k = key.toUpperCase().trim();
      const e = agg.get(k) ?? { name, value: 0, direct: false, funds: new Set<string>() };
      e.value += value;
      if (opts.direct) e.direct = true;
      if (opts.fund) e.funds.add(opts.fund);
      if (name && name.length > e.name.length) e.name = name;
      agg.set(k, e);
    };

    // Resolve + fetch fundamentals for every position (both cached aggressively)
    const enriched = await Promise.all(
      positions.map(async (p) => {
        const guess = prettyTicker(p.instrument.ticker);
        const symbol = await resolveSymbol(p.instrument.name, guess);
        const fund = await fetchFundInfo(symbol);
        return { p, guess, symbol, fund };
      }),
    );

    for (const { p, guess, symbol, fund } of enriched) {
      const value = p.walletImpact.currentValue;
      if (value <= 0) continue;

      if (fund?.isEtf && fund.holdings.length > 0) {
        resolvedEtfs++;
        let covered = 0;
        for (const h of fund.holdings) {
          add(h.symbol || h.name, h.name || h.symbol, value * h.weight, { fund: guess });
          covered += h.weight;
        }
        otherValue += value * Math.max(0, 1 - covered); // remainder inside the ETF
      } else if (fund && !fund.isEtf) {
        // A single stock (or a fund Yahoo won't decompose) is its own 100% underlying
        add(symbol || guess, p.instrument.name, value, { direct: true });
      } else if (fund?.isEtf) {
        // ETF we can't see inside (no holdings from Yahoo) — count as diversified other
        otherValue += value;
      } else {
        unclassifiedValue += value;
        unresolved.push(prettyTicker(p.instrument.ticker));
      }
    }

    const stocks: LookThroughStock[] = [...agg.entries()]
      .map(([symbol, e]) => ({
        symbol,
        name: e.name,
        value: e.value,
        pct: total > 0 ? e.value / total : 0,
        direct: e.direct,
        funds: [...e.funds],
      }))
      .sort((a, b) => b.value - a.value);

    const otherPct = total > 0 ? (otherValue + unclassifiedValue) / total : 0;
    const payload: LookThroughResult = {
      stocks,
      currency,
      totalValue: total,
      otherPct,
      coveredPct: total > 0 ? 1 - unclassifiedValue / total : 0,
      resolvedEtfs,
      unresolved,
      fetchedAt: new Date().toISOString(),
    };
    store.__lookthrough = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
