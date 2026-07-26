"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/analytics";
import type { DigestPayload, MoverNote } from "@/app/api/digest/route";

// Today's digest is kept in localStorage so revisiting the page is instant and
// never re-runs the (slow, paid) build. Only "Rebuild" fetches again.
const CACHE_KEY = "dividend-tracker-digest-v1";

function readCache(): DigestPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as DigestPayload;
    return p?.date === new Date().toISOString().slice(0, 10) ? p : null;
  } catch {
    return null;
  }
}

// Rough stage timings so the bar reflects what the server is actually doing.
const STAGES = [
  { at: 0, label: "Fetching market data…" },
  { at: 0.22, label: "Reading today's headlines…" },
  { at: 0.4, label: "Checking your portfolio movers…" },
  { at: 0.58, label: "Writing your digest…" },
  { at: 0.92, label: "Almost there…" },
];

const MOOD: Record<DigestPayload["mood"], { label: string; cls: string }> = {
  "risk-on": { label: "Risk-on", cls: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent" },
  "risk-off": { label: "Risk-off", cls: "bg-[color-mix(in_srgb,var(--red)_16%,transparent)] text-red" },
  mixed: { label: "Mixed", cls: "bg-surface text-muted" },
  quiet: { label: "Quiet", cls: "bg-surface text-muted-2" },
};

/** Render the AI body: "- " bullets and **bold**, nothing else. */
function Body({ text }: { text: string }) {
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const prose = lines.filter((l) => !l.startsWith("- "));
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted">
      {prose.map((p, i) => (
        <p key={`p${i}`}>{bold(p)}</p>
      ))}
      {bullets.length > 0 && (
        <ul className="space-y-1.5">
          {bullets.map((b, i) => (
            <li key={`b${i}`} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
              <span>{bold(b)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MoverCard({ m, currency, up }: { m: MoverNote; currency: string; up: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface/40 p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{m.ticker}</span>
        <span className={`num ml-auto whitespace-nowrap text-xs font-semibold ${up ? "text-accent" : "text-red"}`}>
          {m.dayChange >= 0 ? "+" : ""}
          {formatMoney(m.dayChange, currency, 0)} ({(m.dayChangePct * 100).toFixed(2)}%)
        </span>
      </div>
      <div className="truncate text-xs text-muted-2" title={m.name}>
        {m.name} · {formatMoney(m.value, currency, 0)}
      </div>
      {m.why && <p className="mt-2 text-xs leading-relaxed text-muted">{m.why}</p>}
      {m.links.length > 0 && (
        <ul className="mt-2 space-y-1">
          {m.links.slice(0, 3).map((l) => (
            <li key={l.link} className="min-w-0 text-[11px]">
              <a href={l.link} target="_blank" rel="noopener noreferrer" className="block truncate text-primary hover:underline" title={l.title}>
                {l.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DigestPage() {
  const [data, setData] = useState<DigestPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0);

  const load = async (fresh: boolean) => {
    setBuilding(true);
    setProgress(0.04);
    setError(null);
    try {
      const res = await fetch(`/api/digest${fresh ? "?fresh=1" : ""}`);
      // A platform timeout (502/504) returns HTML, not JSON — read defensively so
      // the user gets the real reason instead of a generic network message.
      const raw = await res.text();
      let j: (DigestPayload & { message?: string }) | null = null;
      try {
        j = JSON.parse(raw);
      } catch {
        /* non-JSON error page */
      }
      if (!res.ok || !j) {
        setError(
          j?.message ??
            (res.status === 502 || res.status === 504
              ? "The digest took too long to build and the server cut it off. Press Rebuild — the market data is cached now, so the retry is much faster."
              : `Could not build the digest (HTTP ${res.status}).`),
        );
        return;
      }
      const payload: DigestPayload = j;
      setProgress(1);
      setData(payload);
      // Only persist a complete digest — caching a run whose commentary failed
      // would pin the failure for the rest of the day.
      if (payload.sections?.length) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
        } catch {
          /* quota — cache is only an optimisation */
        }
      }
    } catch {
      setError("Could not reach the API.");
    } finally {
      setBuilding(false);
    }
  };

  // Show today's cached digest instantly; only build when there isn't one.
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(cached);
      return;
    }
    load(false);
  }, []);

  // Ease the bar forward while the request is in flight (a single long call, so
  // there are no real milestones to hook into).
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => setProgress((p) => (p < 0.93 ? p + (0.93 - p) * 0.035 : p)), 400);
    return () => clearInterval(t);
  }, [building]);

  if (error && !data) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-red">{error}</p>
          <button
            onClick={() => load(true)}
            disabled={building}
            className="mt-4 rounded-md border border-border px-4 py-2 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
          >
            {building ? `Rebuilding… ${Math.round(progress * 100)}%` : "Rebuild"}
          </button>
        </div>
      </main>
    );
  }

  if (!data) {
    const pct = Math.min(100, Math.round(progress * 100));
    const stage = [...STAGES].reverse().find((s) => progress >= s.at)?.label ?? STAGES[0].label;
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16">
        <h1 className="text-center text-lg font-semibold">Building today&apos;s digest</h1>
        <div className="mx-auto mt-6 max-w-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">{stage}</span>
            <span className="num text-xs text-muted-2">{pct}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 text-xs text-muted-2">
            Gathering macro data, headlines and your movers, then writing the analysis. Takes ~40–70s — after this it&apos;s saved for the day and opens instantly.
          </p>
        </div>
      </main>
    );
  }

  const cur = data.currency;
  const p = data.portfolio;
  const mood = MOOD[data.mood] ?? MOOD.mixed;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Daily digest</h1>
          <p className="mt-1 text-xs text-muted sm:text-sm">
            {new Date(data.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · macro + your portfolio, explained
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${mood.cls}`}>{mood.label}</span>
          <button
            onClick={() => load(true)}
            disabled={building}
            title="Fetches fresh market data and rewrites the digest"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
          >
            {building ? `Rebuilding… ${Math.round(progress * 100)}%` : "Rebuild"}
          </button>
        </div>
      </div>

      {building && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500 ease-out" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {/* Headline take */}
      <section className="mt-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
        <p className="text-base font-semibold leading-snug">{data.headline}</p>
        {/* A note alongside real commentary is informational (e.g. written by the
            faster model); a note with no sections means the commentary failed. */}
        {data.note && <p className={`mt-2 text-xs ${data.sections.length > 0 ? "text-muted-2" : "text-red"}`}>{data.note}</p>}
        <div className="num mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-2">Portfolio</div>
            <div className="font-semibold">{formatMoney(p.totalValue, cur)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-2">Today</div>
            <div className={`font-semibold ${(p.dayChange ?? 0) >= 0 ? "text-accent" : "text-red"}`}>
              {p.dayChange == null ? "—" : `${p.dayChange >= 0 ? "+" : ""}${formatMoney(p.dayChange, cur, 0)}`}
              {p.dayChangePct != null && <span className="ml-1 text-xs">({(p.dayChangePct * 100).toFixed(2)}%)</span>}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-2">Total return</div>
            <div className={`font-semibold ${(p.totalReturn ?? 0) >= 0 ? "text-accent" : "text-red"}`}>
              {p.totalReturn == null ? "—" : `${p.totalReturn >= 0 ? "+" : ""}${formatMoney(p.totalReturn, cur, 0)}`}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-2">Dividends · 7d</div>
            <div className="font-semibold text-accent">{formatMoney(p.dividendsThisWeek, cur)}</div>
          </div>
        </div>
        {p.dividendsToday.length > 0 && (
          <p className="num mt-3 text-xs text-accent">
            Paid today: {p.dividendsToday.map((d) => `${d.ticker} ${formatMoney(d.amount, cur)}`).join(" · ")}
          </p>
        )}
      </section>

      {/* Macro strip */}
      <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
        <h2 className="text-sm font-semibold tracking-wide">Markets today</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.macro.map((m) => (
            <div key={m.symbol} className="rounded-xl border border-border bg-surface/40 p-3">
              <div className="truncate text-[11px] text-muted-2" title={m.name}>
                {m.name}
              </div>
              <div className="num text-sm font-semibold">{m.price != null ? m.price.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : "—"}</div>
              <div className={`num text-xs font-medium ${(m.changePct ?? 0) >= 0 ? "text-accent" : "text-red"}`}>
                {m.changePct == null ? "—" : `${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(2)}%`}
              </div>
              <div className="num mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-2">
                {m.monthPct != null && (
                  <span title="1 month">
                    1m {m.monthPct >= 0 ? "+" : ""}
                    {m.monthPct.toFixed(1)}%
                  </span>
                )}
                {m.yearPct != null && (
                  <span title="1 year">
                    1y {m.yearPct >= 0 ? "+" : ""}
                    {m.yearPct.toFixed(1)}%
                  </span>
                )}
              </div>
              {m.pctOf52wRange != null && (
                <div className="mt-1.5" title={`${m.pctOf52wRange.toFixed(0)}% of the 52-week range (${m.low52?.toFixed(2)}–${m.high52?.toFixed(2)})`}>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-surface">
                    <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.max(2, Math.min(100, m.pctOf52wRange))}%` }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* AI sections */}
      {data.sections.length > 0 && (
        <div className="mt-6 grid gap-6">
          {data.sections.map((s) => (
            <section key={s.heading} className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
              <h2 className="mb-3 text-sm font-semibold tracking-wide">{s.heading}</h2>
              <Body text={s.body} />
            </section>
          ))}
        </div>
      )}

      {/* Daily macro lesson */}
      {data.education.length > 0 && (
        <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="text-sm font-semibold tracking-wide">Learn today</h2>
          <p className="mb-4 mt-0.5 text-xs text-muted-2">Macro concepts today&apos;s market actually demonstrated — with further reading.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {data.education.map((t) => (
              <article key={t.concept} className="min-w-0 rounded-xl border border-border bg-surface/40 p-4">
                <h3 className="text-sm font-semibold text-primary">{t.concept}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{t.explain}</p>
                {t.today && (
                  <p className="mt-2 rounded-lg bg-card px-3 py-2 text-xs leading-relaxed text-muted">
                    <span className="font-semibold text-foreground">Today: </span>
                    {t.today}
                  </p>
                )}
                {t.readMore.length > 0 && (
                  <ul className="mt-2.5 space-y-1">
                    {t.readMore.map((r) => (
                      <li key={r.url} className="min-w-0 text-[11px]">
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-primary hover:underline" title={r.title}>
                          ↗ {r.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Wider market movers — names the investor does NOT hold */}
      {(data.marketMovers?.usGainers?.length ||
        data.marketMovers?.usLosers?.length ||
        data.marketMovers?.euGainers?.length ||
        data.marketMovers?.euLosers?.length) > 0 && (
        <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="text-sm font-semibold tracking-wide">Market movers</h2>
          <p className="mb-4 mt-0.5 text-xs text-muted-2">Biggest large-cap moves today across the US and Europe — market colour, not your holdings.</p>
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {(
              [
                ["US · gainers", data.marketMovers.usGainers, true],
                ["US · losers", data.marketMovers.usLosers, false],
                ["Europe · gainers", data.marketMovers.euGainers, true],
                ["Europe · losers", data.marketMovers.euLosers, false],
              ] as const
            ).map(([label, list, up]) =>
              list.length === 0 ? null : (
                <div key={label}>
                  <h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${up ? "text-accent" : "text-red"}`}>{label}</h3>
                  <ul className="space-y-1.5">
                    {list.map((m) => (
                      <li key={m.symbol} className="flex items-baseline gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate" title={m.name}>
                          {m.name}
                        </span>
                        <span className="num shrink-0 text-[10px] text-muted-2">{m.symbol}</span>
                        <span className={`num shrink-0 font-semibold ${m.changePct >= 0 ? "text-accent" : "text-red"}`}>
                          {m.changePct >= 0 ? "+" : ""}
                          {m.changePct.toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        </section>
      )}

      {/* Movers */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-accent">Top gainers today</h2>
          {data.gainers.length === 0 ? (
            <p className="text-xs text-muted-2">Nothing up today.</p>
          ) : (
            <div className="grid gap-3">
              {data.gainers.map((m) => (
                <MoverCard key={m.ticker} m={m} currency={cur} up />
              ))}
            </div>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-red">Top losers today</h2>
          {data.losers.length === 0 ? (
            <p className="text-xs text-muted-2">Nothing down today.</p>
          ) : (
            <div className="grid gap-3">
              {data.losers.map((m) => (
                <MoverCard key={m.ticker} m={m} currency={cur} up={false} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Sources */}
      <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
        <h2 className="mb-1 text-sm font-semibold tracking-wide">Sources &amp; further reading</h2>
        <p className="mb-3 text-xs text-muted-2">Every headline the digest was built from — click through to read the original.</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {data.news.map((n) => (
            // min-w-0 on the flex child is what lets `truncate` actually clip —
            // without it the item's automatic minimum width pushes the page wide.
            <li key={n.link} className="flex min-w-0 items-baseline gap-1 text-xs">
              <a href={n.link} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-primary hover:underline" title={n.title}>
                {n.title}
              </a>
              <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-2">· {n.publishedAt.slice(5, 10)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8 text-center text-[11px] text-muted-2">
        Generated {new Date(data.generatedAt).toLocaleString("en-GB")} · headlines via Google News &amp; Yahoo Finance RSS · commentary by Claude on your own data · not financial advice
      </p>
    </main>
  );
}
