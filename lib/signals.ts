// Signal engine: quote shapes, technical indicators, and the composite buy/sell verdict.
// Data comes from Yahoo Finance's public chart endpoint (no key) — see app/api/quotes.

export interface ForecastPoint {
  months: number;
  expected: number;
  low: number; // -1σ path
  high: number; // +1σ path
}

export interface Insights {
  suggestedBuy: number; // model buy-below level
  suggestedSell: number; // model sell-above level
  targetBasis: string; // how the levels were derived, for the UI tooltip
  return1y: number; // fraction
  annualVol: number; // annualized volatility, fraction
  annualDrift: number; // annualized log-drift, fraction
  maxDrawdown: number; // worst peak-to-trough over the year, fraction (negative)
  rangePos: number; // 0 = at 52w low, 1 = at 52w high
  trend: "up" | "down" | "flat";
  forecast: ForecastPoint[];
}

export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  prevClose: number;
  changePct: number; // day change, fraction
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  high52w: number;
  low52w: number;
  spark: number[]; // ~90 daily closes for the mini chart
  insights: Insights | null;
  updatedAt: string;
}

export interface WatchItem {
  symbol: string;
  name: string;
  buyBelow?: number | null;
  sellAbove?: number | null;
  fromHolding?: boolean;
}

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
}

export interface Sentiment {
  stance: "bullish" | "bearish" | "neutral";
  score: number; // -1..1
  summary: string;
  generatedAt: string;
}

// ---- Fund / ETF fundamentals ----------------------------------------------

export interface FundHolding {
  symbol: string;
  name: string;
  weight: number; // fraction of the fund
}

export interface SectorWeight {
  sector: string; // pretty label
  weight: number; // fraction
}

export interface FundInfo {
  symbol: string;
  isEtf: boolean;
  category: string | null; // e.g. "Derivative Income", "Large Blend"
  family: string | null; // e.g. "JPMorgan"
  expenseRatio: number | null; // TER, fraction
  yield: number | null; // distribution/SEC yield, fraction
  aum: number | null; // total net assets
  navPrice: number | null;
  premiumPct: number | null; // (price - nav) / nav
  beta3y: number | null;
  threeYearReturn: number | null; // annualized, fraction
  inceptionDate: string | null; // ISO date
  holdings: FundHolding[]; // top holdings, largest first
  topConcentration: number | null; // sum of the top-10 weights
  sectors: SectorWeight[];
}

/** True when Yahoo classes the instrument as a fund/ETF (drives ETF-tuned UI + scoring). */
export function isEtfLike(fund: FundInfo | null | undefined): boolean {
  return !!fund?.isEtf;
}

export interface LookThroughStock {
  symbol: string;
  name: string;
  value: number; // effective account-currency exposure to this name across the portfolio
  pct: number; // value / invested total
  direct: boolean; // also held as a single stock directly
  funds: string[]; // ETF symbols contributing via look-through
}

export interface OpaqueFund {
  name: string;
  ticker: string;
  value: number;
  pct: number; // value / invested total
}

export interface LookThroughResult {
  stocks: LookThroughStock[];
  currency: string;
  totalValue: number; // invested total the percentages are against
  otherPct: number; // diversified remainder (ETF beyond top-10) + unclassified
  coveredPct: number; // share of the portfolio we could see through or hold directly
  resolvedEtfs: number;
  opaqueFunds: OpaqueFund[]; // funds we recognised but couldn't decompose (no holdings from the data source)
  unresolved: string[]; // position names that could not be classified
  fetchedAt: string;
}

/**
 * Informational fund flags for the UI (do not move the verdict; NAV premium does
 * that in evaluateSignal). Each is a plain-language note about cost/structure risk.
 */
export interface FundFlag {
  tone: "good" | "warn" | "info";
  label: string;
  detail: string;
}

export function fundFlags(fund: FundInfo): FundFlag[] {
  const flags: FundFlag[] = [];
  if (fund.expenseRatio != null) {
    if (fund.expenseRatio >= 0.006) flags.push({ tone: "warn", label: `TER ${(fund.expenseRatio * 100).toFixed(2)}%`, detail: "High fund cost — above 0.6%/yr erodes long-run return" });
    else flags.push({ tone: "good", label: `TER ${(fund.expenseRatio * 100).toFixed(2)}%`, detail: "Fund cost (total expense ratio)" });
  }
  if (fund.yield != null && fund.yield > 0) flags.push({ tone: "info", label: `Yield ${(fund.yield * 100).toFixed(1)}%`, detail: "Distribution / SEC yield reported by the fund" });
  if (fund.premiumPct != null && Math.abs(fund.premiumPct) >= 0.005) {
    const prem = fund.premiumPct > 0;
    flags.push({ tone: prem ? "warn" : "good", label: `${prem ? "+" : ""}${(fund.premiumPct * 100).toFixed(2)}% vs NAV`, detail: prem ? "Trading above net asset value — paying a premium" : "Trading below net asset value — at a discount" });
  }
  if (fund.topConcentration != null && fund.topConcentration >= 0.5) {
    flags.push({ tone: "warn", label: `Top-10 ${(fund.topConcentration * 100).toFixed(0)}%`, detail: "Concentrated — the ten largest positions are half or more of the fund" });
  }
  return flags;
}

export type SignalDirection = "buy" | "sell" | "info";

export interface SignalReason {
  direction: SignalDirection;
  label: string;
  detail: string;
  weight: number; // contribution to the composite score, positive = buy
}

export type Verdict = "strong-buy" | "buy" | "hold" | "sell" | "strong-sell";

export interface SignalResult {
  verdict: Verdict;
  score: number;
  reasons: SignalReason[];
  targetHit: "buy" | "sell" | null;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1));
}

const TRADING_DAYS = 252;

/**
 * Model-derived stats, suggested targets and a price forecast from ~1y of daily closes.
 *
 * Targets: 20-day Bollinger band (SMA20 ± 2σ) blended with 1-year percentiles —
 * buy level never above the 40th percentile of the year, sell level never below
 * the 60th. Clamped so buy < price < sell (targets already crossed are still
 * actionable, evaluateSignal handles the hit).
 *
 * Forecast: geometric-Brownian-motion style projection — drift and volatility of
 * daily log returns, expected path P·exp(μ·t) with a ±1σ√t band. Crude by design;
 * it describes the past year's behaviour, not the future.
 */
export function buildInsights(closes: number[], price: number): Insights | null {
  if (closes.length < 30 || price <= 0) return null;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 20) return null;

  const muD = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sigmaD = stdDev(rets);
  const annualDrift = muD * TRADING_DAYS;
  const annualVol = sigmaD * Math.sqrt(TRADING_DAYS);
  const return1y = closes[0] > 0 ? closes[closes.length - 1] / closes[0] - 1 : 0;

  let peak = closes[0];
  let maxDrawdown = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = c / peak - 1;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const rangePos = high > low ? (price - low) / (high - low) : 0.5;

  // Suggested levels: Bollinger(20, 2σ) blended with 1y percentiles
  const last20 = closes.slice(-20);
  const sma20 = last20.reduce((a, b) => a + b, 0) / last20.length;
  const sd20 = stdDev(last20);
  const sorted = [...closes].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  let suggestedBuy = Math.min(sma20 - 2 * sd20, pct(0.4));
  let suggestedSell = Math.max(sma20 + 2 * sd20, pct(0.6));
  // keep levels on sensible sides of the current price
  suggestedBuy = Math.min(suggestedBuy, price * 0.995);
  suggestedSell = Math.max(suggestedSell, price * 1.005);
  if (suggestedBuy <= 0) suggestedBuy = low;

  const trend: Insights["trend"] = annualDrift > 0.05 ? "up" : annualDrift < -0.05 ? "down" : "flat";

  const forecast: ForecastPoint[] = [3, 6, 12].map((months) => {
    const d = (months / 12) * TRADING_DAYS;
    const band = sigmaD * Math.sqrt(d);
    return {
      months,
      expected: price * Math.exp(muD * d),
      low: price * Math.exp(muD * d - band),
      high: price * Math.exp(muD * d + band),
    };
  });

  return {
    suggestedBuy,
    suggestedSell,
    targetBasis: "20-day Bollinger band (SMA20 ± 2σ) blended with the 40th/60th percentile of the last year's closes",
    return1y,
    annualVol,
    annualDrift,
    maxDrawdown,
    rangePos,
    trend,
    forecast,
  };
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Composite signal. User-set price targets dominate; technicals and news
 * sentiment nudge the score. Purely informational — the user places trades.
 */
export function evaluateSignal(q: Quote, item: WatchItem, sentiment?: Sentiment | null, fund?: FundInfo | null): SignalResult {
  const reasons: SignalReason[] = [];
  let targetHit: "buy" | "sell" | null = null;
  const isEtf = isEtfLike(fund);
  // Diversified funds don't mean-revert like single stocks; technicals inform but don't drive.
  const techWeight = isEtf ? 0.4 : 1;

  // User-set targets win; the model's suggested levels fill the gap when unset.
  const buyLevel = item.buyBelow ?? q.insights?.suggestedBuy ?? null;
  const sellLevel = item.sellAbove ?? q.insights?.suggestedSell ?? null;
  const buyIsModel = item.buyBelow == null;
  const sellIsModel = item.sellAbove == null;

  if (buyLevel != null && q.price <= buyLevel) {
    targetHit = "buy";
    reasons.push({
      direction: "buy",
      label: buyIsModel ? "Model buy level hit" : "Buy target hit",
      detail: `Price ${q.price.toFixed(2)} ≤ ${buyIsModel ? "model buy level" : "your buy-below"} ${buyLevel.toFixed(2)}`,
      weight: buyIsModel ? 2 : 3,
    });
  }
  if (sellLevel != null && q.price >= sellLevel) {
    targetHit = "sell";
    reasons.push({
      direction: "sell",
      label: sellIsModel ? "Model sell level hit" : "Sell target hit",
      detail: `Price ${q.price.toFixed(2)} ≥ ${sellIsModel ? "model sell level" : "your sell-above"} ${sellLevel.toFixed(2)}`,
      weight: sellIsModel ? -2 : -3,
    });
  }

  if (q.rsi14 != null) {
    if (q.rsi14 <= 30) {
      reasons.push({ direction: "buy", label: "RSI oversold", detail: `RSI(14) ${q.rsi14.toFixed(0)} ≤ 30`, weight: 1 * techWeight });
    } else if (q.rsi14 >= 70) {
      reasons.push({ direction: "sell", label: "RSI overbought", detail: `RSI(14) ${q.rsi14.toFixed(0)} ≥ 70`, weight: -1 * techWeight });
    }
  }

  if (q.sma50 != null && q.sma200 != null) {
    if (q.sma50 > q.sma200) {
      reasons.push({ direction: "buy", label: "Uptrend", detail: "50-day average above 200-day (golden-cross regime)", weight: 0.5 * techWeight });
    } else {
      reasons.push({ direction: "sell", label: "Downtrend", detail: "50-day average below 200-day (death-cross regime)", weight: -0.5 * techWeight });
    }
  }

  // ETF-specific: trading rich/cheap to net asset value is a real (small) edge
  if (isEtf && fund?.premiumPct != null) {
    if (fund.premiumPct <= -0.005) {
      reasons.push({ direction: "buy", label: "Discount to NAV", detail: `Price ${(fund.premiumPct * 100).toFixed(2)}% below net asset value`, weight: 0.6 });
    } else if (fund.premiumPct >= 0.005) {
      reasons.push({ direction: "sell", label: "Premium to NAV", detail: `Price ${(fund.premiumPct * 100).toFixed(2)}% above net asset value`, weight: -0.6 });
    }
  }

  const range = q.high52w - q.low52w;
  if (range > 0) {
    const posInRange = (q.price - q.low52w) / range;
    if (posInRange <= 0.08) {
      reasons.push({ direction: "buy", label: "Near 52-week low", detail: `Within ${(posInRange * 100).toFixed(0)}% of the 52w low`, weight: 0.5 * techWeight });
    } else if (posInRange >= 0.97) {
      reasons.push({ direction: "info", label: "At 52-week high", detail: "Price at the top of its 52-week range", weight: 0 });
    }
  }

  if (sentiment) {
    if (sentiment.stance !== "neutral") {
      reasons.push({
        direction: sentiment.stance === "bullish" ? "buy" : "sell",
        label: `News ${sentiment.stance}`,
        detail: sentiment.summary,
        weight: Math.max(-1, Math.min(1, sentiment.score)) * 1.5,
      });
    }
  }

  const score = reasons.reduce((a, r) => a + r.weight, 0);
  let verdict: Verdict = "hold";
  if (targetHit === "buy" || score >= 2.5) verdict = "strong-buy";
  else if (targetHit === "sell" || score <= -2.5) verdict = "strong-sell";
  else if (score >= 1.5) verdict = "buy";
  else if (score <= -1.5) verdict = "sell";

  return { verdict, score, reasons, targetHit };
}
