"use client";

import { useEffect, useState } from "react";
import type { EpisodeInfo } from "@/app/api/videos/route";

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

// Ordered pipeline stages, for the progress bar during generation.
const STAGES = ["snapshot", "capture", "script", "broll", "voice", "subtitles", "render", "thumbnail", "publish"] as const;

interface GenJob {
  week: string;
  upload: boolean;
  running: boolean;
  stage: string | null;
  ok: boolean | null;
  error: string | null;
  log: string[];
}

export default function VideosPage() {
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadMsg, setUploadMsg] = useState<Record<string, string>>({});
  const [gen, setGen] = useState<GenJob | null>(null);
  const [genMsg, setGenMsg] = useState<string>("");
  const [uploadAfter, setUploadAfter] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/videos");
      const j = (await res.json()) as { episodes: EpisodeInfo[]; authReady?: boolean };
      setEpisodes(j.episodes ?? []);
      setAuthReady(!!j.authReady);
    } catch {
      setEpisodes([]);
    }
  };

  const loadGen = async () => {
    try {
      const res = await fetch("/api/videos/generate");
      const j = (await res.json()) as { job: GenJob | null };
      setGen(j.job);
      return j.job;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    (async () => {
      await Promise.all([load(), loadGen()]);
    })();
  }, []);

  // While a generation is running, poll status; refresh the episode list when it ends.
  useEffect(() => {
    if (!gen?.running) return;
    const t = setInterval(async () => {
      const j = await loadGen();
      if (j && !j.running) {
        clearInterval(t);
        await load();
        setGenMsg(j.ok ? `Episode ${j.week} generated.` : `Generation failed at "${j.stage ?? "?"}"${j.error ? ` — ${j.error}` : ""}. See the log below.`);
      }
    }, 2500);
    return () => clearInterval(t);
  }, [gen?.running]);

  const startGenerate = async () => {
    setGenMsg("");
    try {
      const res = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload: uploadAfter }),
      });
      const j = await res.json();
      if (!res.ok) {
        setGenMsg(j.message ?? "Could not start generation.");
        if (j.job) setGen(j.job);
        return;
      }
      setGen(j.job);
    } catch {
      setGenMsg("Could not reach the generator — is the local dev server running?");
    }
  };

  const upload = async (week: string) => {
    setUploading((p) => ({ ...p, [week]: true }));
    setUploadMsg((p) => ({ ...p, [week]: "" }));
    try {
      const res = await fetch(`/api/videos/${week}/upload`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setUploadMsg((p) => ({ ...p, [week]: j.message ?? "Upload failed" }));
        return;
      }
      await load(); // picks up studioUrl from upload.json
    } catch {
      setUploadMsg((p) => ({ ...p, [week]: "Upload failed — is the dev server still running?" }));
    } finally {
      setUploading((p) => ({ ...p, [week]: false }));
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Episodes</h1>
      <p className="mt-1 text-sm text-muted">
        Weekly FIRE-journey videos generated from this tool — script by Claude, voiced with Dia, rendered, ready for YouTube review.
      </p>

      {/* One-click generation. Runs the full pipeline locally (needs the dev server). */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <button
            onClick={startGenerate}
            disabled={!!gen?.running}
            className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {gen?.running ? "Generating…" : "✨ Generate this week's episode"}
          </button>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={uploadAfter} onChange={(e) => setUploadAfter(e.target.checked)} disabled={!!gen?.running} className="h-3.5 w-3.5" />
            upload YouTube draft when done
          </label>
          {!gen?.running && <span className="text-xs text-muted-2">Snapshot → script → Dia voice → render{uploadAfter ? " → upload" : ""} · a few minutes, runs on this machine</span>}
        </div>

        {gen && (gen.running || gen.stage) && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((s) => {
                const activeIdx = gen.stage ? STAGES.indexOf(gen.stage as (typeof STAGES)[number]) : -1;
                const idx = STAGES.indexOf(s);
                const done = gen.stage === "done" || (activeIdx > -1 && idx < activeIdx) || (!gen.running && gen.ok);
                const active = gen.running && gen.stage === s;
                return (
                  <span
                    key={s}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${active ? "bg-[var(--primary)] text-white" : done ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent" : "bg-surface text-muted-2"}`}
                  >
                    {active ? "▸ " : done ? "✓ " : ""}
                    {s}
                  </span>
                );
              })}
            </div>
            {gen.log?.length > 0 && (
              <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/90 p-3 text-[11px] leading-relaxed text-green-300">{gen.log.join("\n")}</pre>
            )}
          </div>
        )}
        {genMsg && <p className={`mt-3 text-xs ${gen && !gen.running && gen.ok ? "text-accent" : "text-red"}`}>{genMsg}</p>}
      </section>

      {!episodes && <div className="mt-8 flex h-32 items-center justify-center text-sm text-muted-2">Loading episodes…</div>}

      {episodes && episodes.length === 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted">
          No episodes yet. Generate the first one:
          <pre className="mx-auto mt-3 w-fit rounded-lg bg-surface px-4 py-2 text-left text-xs">cd video && npm run episode</pre>
        </div>
      )}

      <div className="mt-6 grid gap-6">
        {episodes?.map((ep) => (
          <section key={ep.week} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="grid gap-0 lg:grid-cols-[2fr_1fr]">
              <div className="bg-black">
                {ep.hasVideo ? (
                  <video
                    controls
                    preload="metadata"
                    className="aspect-video w-full"
                    src={`/api/videos/${ep.week}`}
                    poster={ep.hasThumbnail ? `/api/videos/${ep.week}/thumbnail` : undefined}
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-muted-2">not rendered yet</div>
                )}
              </div>
              <div className="flex flex-col p-5">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-primary">{ep.week}</span>
                  {ep.thumbnailText && <span className="rounded-lg bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">{ep.thumbnailText}</span>}
                </div>
                <h2 className="mt-2 text-sm font-semibold leading-snug">{ep.title ?? "Untitled episode"}</h2>
                <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-2">
                  <span>{fmtDuration(ep.durationSec)} min</span>
                  {ep.sizeMb != null && <span>{ep.sizeMb} MB</span>}
                  {ep.voice && <span>voice: {ep.voice}</span>}
                </div>
                {ep.description && (
                  <div className="mt-3 text-xs leading-relaxed text-muted">
                    <p className={open[ep.week] ? "" : "line-clamp-4"}>{ep.description}</p>
                    <button onClick={() => setOpen((p) => ({ ...p, [ep.week]: !p[ep.week] }))} className="mt-1 font-medium text-primary hover:underline">
                      {open[ep.week] ? "less" : "more"}
                    </button>
                  </div>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
                  {ep.studioUrl ? (
                    <a href={ep.studioUrl} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                      Review in YouTube Studio
                    </a>
                  ) : ep.hasVideo ? (
                    <button
                      onClick={() => upload(ep.week)}
                      disabled={!!uploading[ep.week]}
                      title={authReady ? "Uploads as an unlisted draft with the thumbnail — you publish in YouTube Studio" : "One-time setup: cd video && npm run publish (Google consent in the browser), then this works"}
                      className="rounded-xl bg-[var(--red)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {uploading[ep.week] ? "Uploading…" : "▶ Upload to YouTube"}
                    </button>
                  ) : null}
                  {ep.hasVideo && (
                    <a href={`/api/videos/${ep.week}`} download={`${ep.week}.mp4`} className="text-xs font-medium text-primary hover:underline">
                      Download mp4
                    </a>
                  )}
                  {ep.hasThumbnail && (
                    <a href={`/api/videos/${ep.week}/thumbnail`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">
                      Thumbnail
                    </a>
                  )}
                </div>
                {uploadMsg[ep.week] && <p className="mt-2 text-xs text-red">{uploadMsg[ep.week]}</p>}
              </div>
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 text-center text-[11px] text-muted-2">
        Pipeline: snapshot → screenshots → Claude script → TTS → Remotion render → YouTube draft · <code className="rounded bg-surface px-1.5 py-0.5">cd video && npm run episode -- --upload</code>
      </p>
    </main>
  );
}
