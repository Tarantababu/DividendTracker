// Stage 4: .srt from the script text + measured audio durations. Sentences are
// spread across each segment's audio proportionally to their character length.
import fs from "node:fs";
import path from "node:path";
import { episodeDir, isoWeekId, readJson } from "./util.ts";
import type { EpisodeScript } from "./script.ts";
import type { AudioManifest } from "./voice.ts";

const GAP = 0.5; // seconds of silence between scenes (must match remotion/Episode.tsx)

function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+["']?|\S[^.!?]*$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

function main() {
  const week = isoWeekId();
  const dir = episodeDir(week);
  const script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  const manifest = readJson<AudioManifest>(path.join(dir, "audio", "manifest.json"));
  if (!script || !manifest) throw new Error("script.json / audio manifest missing — run earlier stages first");

  let t = 0;
  let n = 0;
  const cues: string[] = [];
  for (const seg of script.segments) {
    const audio = manifest.segments.find((a) => a.id === seg.id);
    if (!audio) continue;
    const parts = sentences(seg.voiceover);
    const totalChars = parts.reduce((a, p) => a + p.length, 0) || 1;
    let cursor = t;
    for (const p of parts) {
      const d = (p.length / totalChars) * audio.duration;
      cues.push(`${++n}\n${srtTime(cursor)} --> ${srtTime(Math.min(cursor + d, t + audio.duration))}\n${p}\n`);
      cursor += d;
    }
    t += audio.duration + GAP;
  }
  const out = path.join(dir, "episode.srt");
  fs.writeFileSync(out, cues.join("\n"), "utf8");
  console.log(`[subtitles] ${n} cues -> episode.srt`);
}

try {
  main();
} catch (err) {
  console.error("[subtitles] FAILED:", (err as Error).message ?? err);
  process.exit(1);
}
