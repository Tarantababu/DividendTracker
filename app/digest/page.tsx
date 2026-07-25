"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/analytics";
import type { DigestPayload, MoverNote } from "@/app/api/digest/route";

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
    <div className="rounded-xl border border-border bg-surface/40 p-3.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{m.ticker}</span>
        <span className={`num ml-auto text-xs font-semibold ${up ? "text-accent" : "text-red"}`}>
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
            <li key={l.link} className="truncate text-[11px]">
              <a href={l.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" title={l.title}>
                {l.title}
              </a>
              {l.source && <span className="text-muted-2"> · {l.source}</span>}
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
  const [refreshing, setRefreshing] = useState(false);

  const load = async (fresh: boolean) => {
    if (fresh) setRefreshing(true);
    try {
      const res = await fetch(`/api/digest${fresh ? "?fresh=1" : ""}`);
      const j = await res.json();
      if (!res.ok) {
        setError(j.message ?? "Could not build the digest.");
        return;
      }
      setData(j as DigestPayload);
      setError(null);
    } catch {
      setError("Could not reach the API.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
  }, []);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-red">{error}</div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <div className="animate-pulse text-center text-sm text-muted">Reading the markets and your portfolio…</div>
        <p className="mt-2 text-center text-xs text-muted-2">Gathering headlines, macro data and today&apos;s movers, then writing the digest. First run takes ~30–60s.</p>
      </main>
    );
  }

  const cur = data.currency;
  const p = data.portfolio;
  const mood = MOOD[data.mood] ?? MOOD.mixed;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily digest</h1>
          <p className="mt-1 text-sm text-muted">
            {new Date(data.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · macro + your portfolio, explained
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${mood.cls}`}>{mood.label}</span>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="rounded-xl border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
          >
            {refreshing ? "Rebuilding…" : "Rebuild"}
          </button>
        </div>
      </div>

      {/* Headline take */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <p className="text-base font-semibold leading-snug">{data.headline}</p>
        {data.note && <p className="mt-2 text-xs text-red">{data.note}</p>}
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
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
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
            </div>
          ))}
        </div>
      </section>

      {/* AI sections */}
      {data.sections.length > 0 && (
        <div className="mt-6 grid gap-6">
          {data.sections.map((s) => (
            <section key={s.heading} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold tracking-wide">{s.heading}</h2>
              <Body text={s.body} />
            </section>
          ))}
        </div>
      )}

      {/* Movers */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
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
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
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
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold tracking-wide">Sources &amp; further reading</h2>
        <p className="mb-3 text-xs text-muted-2">Every headline the digest was built from — click through to read the original.</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {data.news.map((n) => (
            <li key={n.link} className="truncate text-xs">
              <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" title={n.title}>
                {n.title}
              </a>
              <span className="text-muted-2">
                {" "}
                · {n.source} · {n.publishedAt.slice(5, 10)}
              </span>
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
