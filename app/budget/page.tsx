"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import { formatMoney } from "@/lib/analytics";
import { applyOverrides, summarize, CATEGORY_RULES, type Txn } from "@/lib/budget";
import type { BankStatus } from "@/app/api/bank/status/route";
import type { BankTransactionsPayload } from "@/app/api/bank/transactions/route";
import StatCard from "@/components/StatCard";

const OVERRIDES_KEY = "dividend-tracker-budget-overrides-v1";

const CATEGORY_OPTIONS = [
  ...CATEGORY_RULES.map((c) => ({ key: c.key, label: c.label })),
  { key: "other-income", label: "Other income" },
  { key: "other-expense", label: "Other spending" },
];

const CAT_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#f97316", "#8b5cf6"];

/** File-picker button (hidden input wrapped in a label). */
function CsvButton({ className, children, onFile }: { className: string; children: React.ReactNode; onFile: (f: File) => void }) {
  return (
    <label className={className}>
      {children}
      <input
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

export default function BudgetPage() {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [data, setData] = useState<BankTransactionsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });

  const loadTxns = useCallback(async (force = false) => {
    const res = await fetch(`/api/bank/transactions${force ? "?force=1" : ""}`);
    if (!res.ok) {
      if (res.status !== 409) {
        const e = await res.json().catch(() => ({}));
        setError(e.message ?? "Could not load transactions");
      }
      return;
    }
    setError(null);
    setData((await res.json()) as BankTransactionsPayload);
  }, []);

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/bank/status");
    const s = (await res.json()) as BankStatus;
    setStatus(s);
    if (s.linked) await loadTxns(false);
    return s;
  }, [loadTxns]);

  useEffect(() => {
    (async () => {
      await refreshStatus();
      setLoading(false);
    })();
  }, [refreshStatus]);

  useEffect(() => {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  }, [overrides]);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/bank/link", { method: "POST" });
      const j = await res.json();
      if (res.ok && j.link) window.location.href = j.link as string;
      else setError(j.message ?? "Could not start the connection");
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    await fetch("/api/bank/disconnect", { method: "POST" });
    setData(null);
    await refreshStatus();
    setBusy(false);
  }, [refreshStatus]);

  const importCsv = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const text = await file.text();
        const res = await fetch("/api/bank/import", { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
        const j = await res.json();
        if (!res.ok) {
          setError(j.message ?? "Import failed");
          return;
        }
        await refreshStatus();
      } catch {
        setError("Could not read the file.");
      } finally {
        setBusy(false);
      }
    },
    [refreshStatus],
  );

  const forceSync = useCallback(async () => {
    setBusy(true);
    await loadTxns(true);
    setBusy(false);
  }, [loadTxns]);

  // Apply user category overrides client-side, then recompute the budget
  const txns: Txn[] = useMemo(() => (data ? applyOverrides(data.txns, overrides) : []), [data, overrides]);
  const summary = useMemo(() => (txns.length ? summarize(txns) : null), [txns]);

  const setCategory = useCallback((counterparty: string, category: string) => {
    setOverrides((prev) => ({ ...prev, [counterparty.toLowerCase().trim()]: category }));
  }, []);

  const cur = summary?.currency ?? "EUR";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold tracking-tight">Budget</h1>
      <p className="mt-1 text-sm text-muted">
        Income, spending and savings rate from your N26 account — import a CSV export (no signup), or connect automatically over PSD2 via GoCardless.
      </p>

      {loading && <div className="mt-8 flex h-40 items-center justify-center text-sm text-muted-2">Checking your N26 connection…</div>}

      {/* Not configured — CSV import (primary) + GoCardless (secondary) */}
      {!loading && status && !status.configured && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_5%,var(--card))] p-6 text-sm">
            <h2 className="font-semibold">Import an N26 CSV — works right now</h2>
            <p className="mt-2 text-muted">
              No signup, no credentials, nothing leaves your machine. In the N26 app or web banking open{" "}
              <span className="font-medium text-foreground">Transactions → Export / Statements</span>, download a <span className="font-medium text-foreground">CSV</span> for the period you want, then drop it here.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <CsvButton onFile={importCsv} className="cursor-pointer rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                {busy ? "Importing…" : "Choose N26 CSV"}
              </CsvButton>
              <span className="text-xs text-muted-2">.csv — booking date, partner name, amount</span>
            </div>
            {error && <p className="mt-3 text-xs text-red">{error}</p>}
          </div>

          <details className="rounded-xl border border-border bg-card p-6 text-sm">
            <summary className="cursor-pointer font-semibold">Prefer automatic sync? Connect via GoCardless (PSD2)</summary>
            <p className="mt-2 text-muted">
              The sanctioned live connection — a licensed PSD2 provider that never sees your N26 password (you log in on N26&apos;s own page).
              <span className="text-amber-600"> Note: GoCardless sometimes pauses new signups; if so, use CSV import above.</span>
            </p>
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-muted">
              <li>
                Create a free account at <a href="https://bankaccountdata.gocardless.com/overview/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">GoCardless Bank Account Data</a>.
              </li>
              <li>Open <span className="font-medium text-foreground">Developers → User secrets</span>, create a secret, copy the <span className="font-medium text-foreground">Secret ID</span> and <span className="font-medium text-foreground">Secret Key</span>.</li>
              <li>
                Add them to <code className="rounded bg-surface px-1.5 py-0.5 text-xs">.env.local</code>:
                <pre className="mt-1.5 overflow-x-auto rounded-lg bg-surface p-3 text-xs">GOCARDLESS_SECRET_ID=your-secret-id{"\n"}GOCARDLESS_SECRET_KEY=your-secret-key</pre>
              </li>
              <li>Restart the dev server and reload, then click <span className="font-medium text-foreground">Connect N26</span>.</li>
            </ol>
          </details>
        </div>
      )}

      {/* Configured but not linked — connect button */}
      {!loading && status?.configured && !status.linked && (
        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">{status.pending ? "Finish connecting N26" : "Connect your N26 account"}</h2>
          <p className="mt-1.5 text-sm text-muted">
            {status.pending
              ? "You started a connection but consent isn't complete. Re-open the N26 login, or start over."
              : "You'll be sent to N26 to log in and approve read-only access to your transactions. GoCardless handles it — no password is stored here."}
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={connect} disabled={busy} className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              {busy ? "Starting…" : status.pending ? "Re-open N26 login" : "Connect N26"}
            </button>
            {status.pending && (
              <button onClick={disconnect} disabled={busy} className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-card-hover disabled:opacity-50">
                Start over
              </button>
            )}
          </div>
          {error && <p className="mt-3 text-xs text-red">{error}</p>}
        </div>
      )}

      {/* Linked — budget dashboard */}
      {!loading && status?.linked && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-1 text-xs font-medium text-accent">
              {status.source === "csv" ? "N26 · CSV import" : "N26 connected"}
            </span>
            {data?.syncedAt && (
              <span className="text-xs text-muted-2">
                {status.source === "csv" ? "imported" : "synced"} {new Date(data.syncedAt).toLocaleString()}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              {status.source === "csv" ? (
                <CsvButton onFile={importCsv} className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-card-hover">
                  {busy ? "Importing…" : "Import new CSV"}
                </CsvButton>
              ) : (
                <button onClick={forceSync} disabled={busy} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-card-hover disabled:opacity-50">
                  {busy ? "Syncing…" : "Sync now"}
                </button>
              )}
              <button onClick={disconnect} disabled={busy} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted hover:text-red disabled:opacity-50">
                {status.source === "csv" ? "Clear" : "Disconnect"}
              </button>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-red">{error}</p>}
          {!summary && !error && <div className="mt-6 flex h-32 items-center justify-center text-sm text-muted-2">Loading transactions…</div>}

          {summary && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Avg income / mo" value={formatMoney(summary.avgIncome, cur, 0)} sub="trailing 3 full months" tone="positive" />
                <StatCard label="Avg spend / mo" value={formatMoney(summary.avgExpenses, cur, 0)} sub={`${summary.categories.length} categories`} tone="negative" />
                <StatCard label="Saved / mo" value={formatMoney(summary.avgNet, cur, 0)} sub="income − spending" tone={summary.avgNet >= 0 ? "positive" : "negative"} />
                <StatCard label="Savings rate" value={`${(summary.savingsRate * 100).toFixed(0)}%`} sub="of income kept" tone="primary" />
              </div>

              {/* Monthly income vs spend */}
              <section className="mt-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
                <h2 className="text-sm font-semibold tracking-wide">Monthly cash flow</h2>
                <div className="mt-3 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={summary.months.slice(-12)} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
                      <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fill: "var(--muted-2)", fontSize: 11 }} tickFormatter={(m: string) => m.slice(2)} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="l" tick={{ fill: "var(--muted-2)", fontSize: 11 }} tickFormatter={(v: number) => formatMoney(v, cur, 0)} width={64} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="r" orientation="right" domain={[-0.5, 1]} tick={{ fill: "var(--muted-2)", fontSize: 11 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={40} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v, n) => (n === "savingsRate" ? [`${(Number(v) * 100).toFixed(0)}%`, "Savings rate"] : [formatMoney(Number(v), cur, 0), n === "income" ? "Income" : "Spending"])}
                      />
                      <Bar yAxisId="l" dataKey="income" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={22} />
                      <Bar yAxisId="l" dataKey="expenses" fill="var(--red)" radius={[3, 3, 0, 0]} maxBarSize={22} />
                      <Line yAxisId="r" type="monotone" dataKey="savingsRate" stroke="var(--primary)" strokeWidth={1.8} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Category breakdown + recent transactions */}
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
                  <h2 className="text-sm font-semibold tracking-wide">Where it goes</h2>
                  <p className="mt-0.5 text-xs text-muted-2">Spending by category, trailing 3 months</p>
                  <div className="mt-3 space-y-2">
                    {summary.categories.map((c, i) => {
                      const max = summary.categories[0]?.total || 1;
                      return (
                        <div key={c.key} className="flex items-center gap-2 text-xs">
                          <span className="w-28 shrink-0 truncate">{c.label}</span>
                          <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface">
                            <div className="h-full rounded" style={{ width: `${(c.total / max) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                          </div>
                          <span className="num w-16 shrink-0 text-right font-medium">{formatMoney(c.total / 3, cur, 0)}/mo</span>
                        </div>
                      );
                    })}
                    {summary.categories.length === 0 && <p className="text-xs text-muted-2">No spending in the trailing window yet.</p>}
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
                  <h2 className="text-sm font-semibold tracking-wide">Recent transactions</h2>
                  <p className="mt-0.5 text-xs text-muted-2">Change a category to reclassify every transaction from that merchant</p>
                  <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
                    {txns.slice(0, 40).map((t) => (
                      <li key={t.id} className="flex items-center gap-2 text-xs">
                        <span className="w-14 shrink-0 text-muted-2">{t.date.slice(5)}</span>
                        <span className="min-w-0 flex-1 truncate" title={t.reference}>
                          {t.counterparty || t.reference || "—"}
                        </span>
                        <select
                          value={t.category}
                          onChange={(e) => setCategory(t.counterparty || t.reference, e.target.value)}
                          className="shrink-0 rounded border border-border bg-surface px-1 py-0.5 text-[10px] text-muted"
                        >
                          {CATEGORY_OPTIONS.map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <span className={`num w-16 shrink-0 text-right font-medium ${t.amount >= 0 ? "text-accent" : ""}`}>
                          {t.amount >= 0 ? "+" : ""}
                          {formatMoney(t.amount, cur, 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <p className="mt-4 text-[11px] text-muted-2">
                Transfers (moves to Trading212, savings pots, brokers) are excluded from income and spending so your savings rate isn&apos;t double-counted. These figures feed the{" "}
                <a href="/fire" className="text-primary hover:underline">FIRE page</a>.
                {status.source === "csv" ? " Re-import a fresh CSV to update." : " GoCardless free tier limits syncs to a few per day."}
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
