"use client";

import { useEffect, useState } from "react";
import type { ForecastSettings } from "@/lib/forecast";
import { DEFAULT_SETTINGS } from "@/lib/forecast";

const AGE_KEY = "dividend-tracker-age";
const NOTES_KEY = "dividend-tracker-ai-notes";
const MAX_NOTES_CHARS = 3000;
const RESULT_KEY = "dividend-tracker-ai-analysis";
const SETTINGS_KEY = "dividend-tracker-forecast-settings";

interface StoredResult {
  analysis: string;
  generatedAt: string;
}

/** Minimal renderer for the constrained markdown the API produces (###, ####, bullets, bold, italics). */
function renderInline(text: string, key: number) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <span key={key}>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
        if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
        return p;
      })}
    </span>
  );
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];

  const flush = (key: string) => {
    if (bullets.length) {
      out.push(<ul key={key} className="mb-3 space-y-1.5 pl-5">{bullets}</ul>);
      bullets = [];
    }
  };

  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("#### ")) {
      flush(`f${i}`);
      out.push(<h4 key={i} className="mb-1.5 mt-4 text-sm font-semibold">{renderInline(t.slice(5), i)}</h4>);
    } else if (t.startsWith("### ")) {
      flush(`f${i}`);
      out.push(<h3 key={i} className="mb-2 mt-5 border-b border-border-soft pb-1.5 text-base font-semibold first:mt-0">{renderInline(t.slice(4), i)}</h3>);
    } else if (t.startsWith("- ")) {
      bullets.push(<li key={i} className="list-disc text-sm leading-relaxed text-muted marker:text-muted-2">{renderInline(t.slice(2), i)}</li>);
    } else if (t === "") {
      flush(`f${i}`);
    } else {
      flush(`f${i}`);
      out.push(<p key={i} className="mb-3 text-sm leading-relaxed text-muted">{renderInline(t, i)}</p>);
    }
  });
  flush("end");
  return <div>{out}</div>;
}

export default function AiAnalysis() {
  const [age, setAge] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [result, setResult] = useState<StoredResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // One-time hydration from localStorage after mount
    try {
      const a = localStorage.getItem(AGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (a) setAge(a);
      const n = localStorage.getItem(NOTES_KEY);
      if (n) setNotes(n);
      const r = localStorage.getItem(RESULT_KEY);
      if (r) setResult(JSON.parse(r) as StoredResult);
    } catch {}
  }, []);

  const analyse = async () => {
    setError(null);
    const ageNum = Number(age);
    if (!ageNum || ageNum < 16 || ageNum > 100) {
      setError("Enter your age (16–100) so the strategy advice fits your time horizon.");
      return;
    }
    localStorage.setItem(AGE_KEY, age);
    localStorage.setItem(NOTES_KEY, notes);
    setLoading(true);
    try {
      let settings: ForecastSettings = DEFAULT_SETTINGS;
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } catch {}
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ age: ageNum, settings, notes: notes.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Analysis failed");
      const stored: StoredResult = { analysis: data.analysis, generatedAt: data.generatedAt };
      setResult(stored);
      localStorage.setItem(RESULT_KEY, JSON.stringify(stored));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <label className="mb-3 block">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-2">
          Anything Claude should know? <span className="normal-case tracking-normal">(optional — goals, risk tolerance, upcoming expenses, questions…)</span>
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES_CHARS))}
          rows={3}
          placeholder={'e.g. "I want to buy a flat in ~5 years, so part of this money isn\'t forever-invested. I pay 15% withholding tax on US dividends. Should I drop the covered-call funds?"'}
          className="mt-1 block w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-2 focus:border-muted-2"
        />
        {notes.length > MAX_NOTES_CHARS - 200 && (
          <span className="num mt-1 block text-right text-[11px] text-muted-2">{notes.length}/{MAX_NOTES_CHARS}</span>
        )}
      </label>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-2">Your age</span>
          <input
            type="number"
            min={16}
            max={100}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            onWheel={(e) => (e.target as HTMLInputElement).blur()}
            placeholder="e.g. 32"
            className="num mt-1 block w-28 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-muted-2"
          />
        </label>
        <button
          onClick={analyse}
          disabled={loading}
          className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Analysing… (can take a minute)" : result ? "Re-analyse portfolio" : "Analyse my portfolio"}
        </button>
        {result && (
          <span className="pb-1 text-[11px] text-muted-2">
            Last analysis: {new Date(result.generatedAt).toLocaleString("en-GB")}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--red)_30%,transparent)] bg-[color-mix(in_srgb,var(--red)_6%,transparent)] px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}

      {loading && (
        <div className="animate-pulse rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          Claude is reading your holdings, income history and targets…
        </div>
      )}

      {result && !loading && (
        <div className="rounded-xl border border-border bg-surface/60 px-5 py-4">
          <Markdown text={result.analysis} />
        </div>
      )}

      {!result && !loading && !error && (
        <p className="text-sm text-muted-2">
          Sends your current holdings, dividend history and income targets to Claude (claude-opus-4-8) and returns a personalised assessment:
          allocation health, whether your targets are on track, an age-appropriate yield strategy, and concrete rebalancing suggestions.
          Needs <code className="rounded bg-surface px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code> in <code className="rounded bg-surface px-1 py-0.5 text-xs">.env.local</code>.
        </p>
      )}
    </div>
  );
}
