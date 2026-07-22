import { NextResponse } from "next/server";
import { getAccountSummary, getPositions, T212Error } from "@/lib/t212";
import { prettyTicker } from "@/lib/analytics";
import { fetchFundInfo, looksLikeFund, resolveSymbol } from "@/lib/yahooFund";
import type { LookThroughResult, LookThroughStock, OpaqueFund } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TTL_MS = 30 * 60 * 1000;

interface Agg {
  name: string;
  value: number;
  direct: boolean;
  funds: Set<string>;
}

// Funds with a known, published single-asset composition that public data sources
// won't decompose (e.g. crypto ETPs return no equity holdings). We map them to
// their real underlying so the look-through shows the true exposure instead of an
// "opaque fund". 21BC = 21Shares Bitcoin Core ETP → 100% Bitcoin.
const KNOWN_FUNDS: { match: (name: string, ticker: string) => boolean; holdings: { symbol: string; name: string; weight: number }[] }[] = [
  {
    match: (name, ticker) => /(^|[^A-Z])21BC([^A-Z]|$)/i.test(ticker) || /21\s*shares.*bitcoin|bitcoin core/i.test(name),
    holdings: [{ symbol: "BTC", name: "Bitcoin", weight: 1 }],
  },
];

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
    const opaqueFunds: OpaqueFund[] = []; // funds we recognise but can't see inside
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

    // Resolve + fetch fundamentals for every position (both cached aggressively).
    // If a fund resolves to a listing Yahoo won't decompose (e.g. a Chi-X line),
    // try the common exchange listings until one returns actual holdings.
    const enriched = await Promise.all(
      positions.map(async (p) => {
        const guess = prettyTicker(p.instrument.ticker);
        const symbol = await resolveSymbol(p.instrument.name, guess);
        let fund = await fetchFundInfo(symbol);
        if ((!fund || fund.holdings.length === 0) && looksLikeFund(p.instrument.name)) {
          for (const cand of [guess, `${guess}.L`, `${guess}.DE`, `${guess}.AS`, `${guess}.MI`, `${guess}.PA`]) {
            if (cand === symbol) continue;
            const alt = await fetchFundInfo(cand);
            if (alt && alt.holdings.length > 0) {
              fund = alt;
              break;
            }
          }
        }
        return { p, guess, symbol, fund };
      }),
    );

    for (const { p, guess, symbol, fund } of enriched) {
      const value = p.walletImpact.currentValue;
      if (value <= 0) continue;

      // Known single-asset funds (e.g. 21BC → Bitcoin) that public data won't
      // decompose — map to their real underlying so they show as exposure, not opaque.
      const known = KNOWN_FUNDS.find((k) => k.match(p.instrument.name, guess));
      if (known) {
        resolvedEtfs++;
        for (const h of known.holdings) add(h.symbol, h.name, value * h.weight, { fund: guess });
        continue;
      }

      // A holding is a fund if the data says so OR its name looks like one (Yahoo
      // often misclassifies active/UCITS funds like JGGI as plain EQUITY).
      const isFund = !!fund?.isEtf || looksLikeFund(p.instrument.name);

      if (fund && fund.holdings.length > 0) {
        // Decomposable ETF → split into its underlying stocks
        resolvedEtfs++;
        let covered = 0;
        for (const h of fund.holdings) {
          add(h.symbol || h.name, h.name || h.symbol, value * h.weight, { fund: guess });
          covered += h.weight;
        }
        otherValue += value * Math.max(0, 1 - covered); // remainder inside the ETF
      } else if (isFund) {
        // A fund we recognise but can't see inside — list it as a fund, never a stock
        opaqueFunds.push({ name: p.instrument.name, ticker: guess, value, pct: total > 0 ? value / total : 0 });
        otherValue += value;
      } else if (fund) {
        // Genuine single stock → its own 100% underlying
        add(symbol || guess, p.instrument.name, value, { direct: true });
      } else {
        unclassifiedValue += value;
        unresolved.push(prettyTicker(p.instrument.ticker));
      }
    }
    opaqueFunds.sort((a, b) => b.value - a.value);

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
      opaqueFunds,
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
