"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DividendsPayload, OverviewPayload } from "@/lib/types";
import type { FirePayload } from "@/app/api/fire/route";
import {
  annualGrowthPerHolding,
  dividendGrowthByYear,
  formatMoney,
  formatPct,
  groupByMonth,
  perTickerStats,
  projectFuturePayments,
  totalInRange,
} from "@/lib/analytics";
import StatCard from "@/components/StatCard";
import AllocationPlanner from "@/components/AllocationPlanner";
import CategoryOverview from "@/components/CategoryOverview";
import CategoryBreakdown from "@/components/CategoryBreakdown";
import DailyStatus from "@/components/DailyStatus";
import MonthlyChart from "@/components/MonthlyChart";
import AllocationDonut from "@/components/AllocationDonut";
import HistoryModal from "@/components/HistoryModal";
import HoldingsTable from "@/components/HoldingsTable";
import ForecastPanel from "@/components/ForecastPanel";
import DividendHistory from "@/components/DividendHistory";
import DividendCalendar from "@/components/DividendCalendar";
import AiAnalysis from "@/components/AiAnalysis";
import YieldPayoutChart from "@/components/YieldPayoutChart";
import IncomeDiversification from "@/components/IncomeDiversification";
import FuturePayments from "@/components/FuturePayments";
import DividendsByHolding from "@/components/DividendsByHolding";
import DividendGrowth from "@/components/DividendGrowth";
import GrowthByHolding from "@/components/GrowthByHolding";

interface ApiError {
  error: string;
  message: string;
}

// Last loaded portfolio snapshot for this browser session. Revisiting the
// dashboard paints from it immediately instead of re-running the slow cold
// fetch; "Refresh" is the only thing that pulls fresh data.
const SNAPSHOT_KEY = "dividend-tracker-snapshot-v1";
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

function readSnapshot(): { overview: OverviewPayload; dividends: DividendsPayload } | null {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { at: number; overview: OverviewPayload; dividends: DividendsPayload };
    if (!s?.overview || !s?.dividends || Date.now() - s.at > SNAPSHOT_TTL_MS) return null;
    return { overview: s.overview, dividends: s.dividends };
  } catch {
    return null;
  }
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "income", label: "Income & growth" },
  { id: "holdings", label: "Holdings & history" },
  { id: "allocation", label: "Allocation" },
  { id: "planning", label: "Planning" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted-2">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function LoadingScreen({ progress }: { progress: number }) {
  const pct = Math.min(100, Math.round(progress * 100));
  const label = progress < 0.5 ? "Connecting to Trading212…" : progress < 0.85 ? "Fetching positions & dividends…" : "Almost ready…";
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="num text-xs text-muted-2">{pct}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-2">First load after idle can take ~30s while the live data syncs.</p>
      </div>
    </main>
  );
}

function SetupScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8">
        <h1 className="text-lg font-semibold">Connect your Trading212 account</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Add your API credentials to <code className="rounded bg-surface px-1.5 py-0.5 text-xs">.env.local</code> in the project root, then restart{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-xs">npm run dev</code>:
        </p>
        <pre className="num mt-4 rounded-xl border border-border bg-surface p-4 text-xs leading-relaxed text-muted">
{`T212_API_KEY=your_api_key
T212_API_SECRET=your_api_secret`}
        </pre>
        <p className="mt-4 text-xs leading-relaxed text-muted-2">
          Generate a key in the Trading212 app: Settings → API. Read-only scopes are enough (account, portfolio, history). Keys stay on your machine —
          they are only read server-side and never sent to the browser.
        </p>
      </div>
    </main>
  );
}

export default function Dashboard() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [dividends, setDividends] = useState<DividendsPayload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0.06);
  const [fire, setFire] = useState<FirePayload | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (TABS.some((t) => t.id === fromHash)) setTab(fromHash as TabId);
  }, []);

  const switchTab = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", id === "overview" ? window.location.pathname : `#${id}`);
  };

  const load = useCallback(async (refresh: boolean) => {
    try {
      setProgress(0.12);
      // Fire both requests together but bump the bar as each one lands, so the
      // progress reflects real milestones (overview is the faster of the two).
      const ovP = fetch("/api/overview");
      const divP = fetch(`/api/dividends${refresh ? "?refresh=1" : ""}`);
      ovP.then(() => setProgress((p) => Math.max(p, 0.6))).catch(() => {});
      divP.then(() => setProgress((p) => Math.max(p, 0.85))).catch(() => {});
      const [ovRes, divRes] = await Promise.all([ovP, divP]);
      if (ovRes.status === 428 || divRes.status === 428) {
        setNeedsSetup(true);
        return;
      }
      if (!ovRes.ok) throw await ovRes.json();
      if (!divRes.ok) throw await divRes.json();
      const ov = (await ovRes.json()) as OverviewPayload;
      const dv = (await divRes.json()) as DividendsPayload;
      setOverview(ov);
      setDividends(dv);
      setError(null);
      setProgress(1);
      try {
        sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), overview: ov, dividends: dv }));
      } catch {
        /* quota — the snapshot is only an optimisation */
      }
    } catch (e) {
      const err = e as Partial<ApiError>;
      setError({ error: err.error ?? "NETWORK", message: err.message ?? "Could not reach the local API." });
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  // Ease the bar toward 90% while the (cold, ~30s) serverless fetch is in flight,
  // so it always feels alive even between the real milestones above.
  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setProgress((p) => (p < 0.9 ? p + (0.9 - p) * 0.06 : p)), 350);
    return () => clearInterval(t);
  }, [loading]);

  // Paint from this session's last snapshot so coming back to the dashboard is
  // instant; only fetch when there's nothing cached. "Refresh" always refetches.
  useEffect(() => {
    const snap = readSnapshot();
    if (snap) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverview(snap.overview);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDividends(snap.dividends);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    load(false);
  }, [load]);

  // Net deposits + total return (money-weighted), fetched separately so it never
  // blocks the main render — the Invested/P&L cards upgrade from cost-basis to
  // net-deposit numbers once this lands.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fire");
        if (!res.ok) return;
        const j = (await res.json()) as FirePayload;
        if (!cancelled) setFire(j);
      } catch {
        /* fall back to cost-basis numbers */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    if (!overview || !dividends) return null;
    const currency = overview.summary.currency;
    const items = dividends.items;
    const ttm = totalInRange(items, 365);
    const monthly = groupByMonth(items, 24);
    const monthsWithData = Math.min(12, Math.max(1, monthly.length));
    const avgMonthly = ttm / monthsWithData;
    const invested = overview.summary.investments.currentValue;
    const cost = overview.summary.investments.totalCost;
    const allTime = items.reduce((s, d) => s + d.amount, 0);
    const growthByYear = dividendGrowthByYear(items);
    return {
      currency,
      ttm,
      avgMonthly,
      allTime,
      monthly,
      portfolioYield: invested > 0 ? ttm / invested : null,
      yieldOnCost: cost > 0 ? ttm / cost : null,
      divStats: perTickerStats(items, overview.positions),
      future: projectFuturePayments(items, overview.positions),
      growthData: growthByYear.data,
      growthYears: growthByYear.years,
      holdingGrowth: annualGrowthPerHolding(items, overview.positions),
    };
  }, [overview, dividends]);

  if (needsSetup) return <SetupScreen />;

  if (loading) return <LoadingScreen progress={progress} />;

  if (error || !overview || !dividends || !stats) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-red">{error?.message ?? "Something went wrong."}</p>
          <button
            onClick={() => { setLoading(true); load(false); }}
            className="mt-4 rounded-xl border border-border px-4 py-2 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  const { summary, positions } = overview;
  const cur = stats.currency;
  const cash = summary.cash.availableToTrade + summary.cash.inPies + summary.cash.reservedForOrders;
  const pl = summary.investments.unrealizedProfitLoss;
  // "Invested" = net deposits (real money you put in, deposits − withdrawals), from
  // /api/fire. Total P/L = current total value − net deposits, i.e. everything the
  // money earned (dividends + realised + unrealised + interest). Falls back to the
  // holdings cost basis until the fire payload arrives.
  const netInvested = fire ? fire.netContributions : summary.investments.totalCost;
  const totalReturn = fire ? fire.growth : pl;
  const totalReturnPct = netInvested > 0 ? totalReturn / netInvested : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-0.5 text-xs text-muted-2">
            Trading212 · live account · updated {new Date(overview.fetchedAt).toLocaleTimeString("en-GB")}
            {dividends.lastSync && ` · dividends synced ${new Date(dividends.lastSync).toLocaleString("en-GB")}`}
          </p>
        </div>
        <button
          onClick={() => { setSyncing(true); load(true); }}
          disabled={syncing}
          className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-medium text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Refresh"}
        </button>
      </header>

      {/* Macro picture */}
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-4">
        <StatCard label="Total value" value={formatMoney(summary.totalValue, cur)} sub={`${positions.length} holdings`} />
        <StatCard
          label="Invested"
          value={formatMoney(netInvested, cur)}
          sub={fire ? "net deposits" : `cost basis · value ${formatMoney(summary.investments.currentValue, cur)}`}
        />
        <StatCard
          label="Total P/L"
          value={formatMoney(totalReturn, cur)}
          sub={`${totalReturnPct != null ? formatPct(totalReturnPct) : ""}${fire ? " · incl. dividends" : " · unrealised"}`}
          tone={totalReturn >= 0 ? "positive" : "negative"}
        />
        <StatCard label="Cash" value={formatMoney(cash, cur)} sub={`realised P/L ${formatMoney(summary.investments.realizedProfitLoss, cur)}`} />
        <StatCard label="Yield" value={formatPct(stats.portfolioYield)} sub={`${formatPct(stats.yieldOnCost)} yield on cost`} tone="primary" />
        <StatCard label="Dividends" value={formatMoney(stats.ttm, cur)} sub={`annually · ${formatMoney(stats.avgMonthly, cur)} monthly`} tone="primary" />
        <StatCard
          label="Next 12m · projected"
          value={formatMoney(stats.future.reduce((s, f) => s + f.total, 0), cur)}
          sub="based on trailing year"
          tone="accent"
        />
        <StatCard
          label="Payments received"
          value={String(dividends.items.length)}
          sub={`all-time ${formatMoney(stats.allTime, cur)}`}
        />
      </div>

      {/* Tab bar — sticky right under the app header */}
      <div className="sticky top-13 z-30 -mx-5 mt-6 bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-5 py-2 backdrop-blur-md">
        <div className="no-scrollbar flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id ? "bg-[var(--primary)] text-white" : "text-muted hover:bg-card-hover hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* All tabs stay mounted so chart and calendar state survives switching */}
      <div className={tab === "overview" ? "" : "hidden"}>
        <div className="mt-4">
          <DailyStatus dividends={dividends.items} currency={cur} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Section title="Monthly dividend income" sub="Last 24 months · amber line = 12-month average">
              <MonthlyChart data={stats.monthly} currency={cur} avg={stats.avgMonthly} />
            </Section>
          </div>
          <div className="lg:col-span-2">
            <Section title="Allocation" sub="By current market value">
              <AllocationDonut positions={positions} currency={cur} pies={overview.pies} />
            </Section>
          </div>
        </div>

        <div className="mt-6 empty:hidden">
          <CategoryOverview positions={positions} currency={cur} pies={overview.pies} />
        </div>

        <div className="mt-6 empty:hidden">
          <CategoryBreakdown positions={positions} divStats={stats.divStats} dividends={dividends.items} currency={cur} pies={overview.pies} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Section title="Future payments" sub="Projected from your trailing-year payment pattern">
            <FuturePayments data={stats.future} currency={cur} />
          </Section>
          <Section title="Dividend calendar" sub="Who paid what, on which day — browse months with the arrows">
            <DividendCalendar items={dividends.items} currency={cur} />
          </Section>
        </div>
      </div>

      <div className={tab === "income" ? "" : "hidden"}>
        <div className="mt-4">
          <Section title="Yield / payout" sub="Trailing 12-month dividend yield per holding, on current value">
            <YieldPayoutChart divStats={stats.divStats} currency={cur} />
          </Section>
        </div>

        <div className="mt-6">
          <Section title="Passive income diversification" sub="Share of your dividend income per holding, last 12 months">
            <IncomeDiversification divStats={stats.divStats} currency={cur} />
          </Section>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Section title="Dividends received · by holding" sub="All-time totals · top 12 payers">
            <DividendsByHolding divStats={stats.divStats} currency={cur} />
          </Section>
          <Section title="Average annual growth" sub="Dividends per holding, last 12 months vs the 12 months before">
            <GrowthByHolding data={stats.holdingGrowth} />
          </Section>
        </div>

        <div className="mt-6">
          <Section title="Dividend growth" sub="Same month, year over year">
            <DividendGrowth data={stats.growthData} years={stats.growthYears} currency={cur} />
          </Section>
        </div>
      </div>

      <div className={tab === "holdings" ? "" : "hidden"}>
        <div className="mt-4">
          <Section title="Holdings" sub="Click a column to sort · dividend yield from actual trailing 12-month payouts">
            <HoldingsTable positions={positions} divStats={stats.divStats} currency={cur} />
          </Section>
        </div>

        <div className="mt-6">
          <Section title="Dividend payments" sub="Full history, newest first">
            <DividendHistory items={dividends.items} currency={cur} />
          </Section>
        </div>
      </div>

      <div className={tab === "allocation" ? "" : "hidden"}>
        <div className="mt-4">
          <Section
            title="Category allocation & deposit calculator"
            sub="Categories are your live Trading212 pies (the source of truth) — the calculator splits any deposit so your portfolio drifts toward each pie's target"
          >
            <AllocationPlanner positions={positions} currency={cur} pies={overview.pies} />
          </Section>
        </div>
        <div className="mt-4">
          <CategoryBreakdown positions={positions} divStats={stats.divStats} dividends={dividends.items} currency={cur} pies={overview.pies} />
        </div>
      </div>

      <div className={tab === "planning" ? "" : "hidden"}>
        <div className="mt-4">
          <Section title="Road to financial freedom" sub="When projected dividend income covers each of your targets — adjust the assumptions">
            <ForecastPanel portfolioValue={summary.investments.currentValue} ttmDividends={stats.ttm} currency={cur} />
          </Section>
        </div>

        <div className="mt-6">
          <Section title="AI portfolio analysis" sub="Claude reviews your holdings, income and targets — allocation advice tuned to your age and goals">
            <AiAnalysis />
          </Section>
        </div>
      </div>

      <footer className="mt-10 pb-4 text-center text-[11px] text-muted-2">
        Local-only tool · data via Trading212 public API · forecasts are estimates, not financial advice
      </footer>

      {/* Opened by clicking any ticker or category name (see openHistory) */}
      <HistoryModal currency={cur} />
    </main>
  );
}
