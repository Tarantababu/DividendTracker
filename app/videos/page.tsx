"use client";

import { useEffect, useState } from "react";
import type { EpisodeInfo } from "@/app/api/videos/route";

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

export default function VideosPage() {
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadMsg, setUploadMsg] = useState<Record<string, string>>({});

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

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

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
        Weekly FIRE-journey videos generated from this tool — script by Claude, voiced, rendered, ready for YouTube review.
      </p>

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
