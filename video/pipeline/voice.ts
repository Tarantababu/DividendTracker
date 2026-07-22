// Stage 3: voiceover per segment. Primary: local Dia model (nari-labs/dia).
// Fallbacks: OpenAI TTS (gpt-4o-mini-tts), then macOS `say` (robotic but free)
// so the pipeline stays runnable with no key and no Python env.
// Output: episodes/<week>/audio/<segment>.mp3|m4a + audio/manifest.json with durations.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { audioDuration, episodeDir, isoWeekId, loadConfig, loadEnv, readJson, writeJson, VIDEO_ROOT } from "./util.ts";
import type { EpisodeScript } from "./script.ts";
import type { VideoConfig } from "./util.ts";

export interface AudioSegment {
  id: string;
  file: string; // relative to the episode dir
  duration: number; // seconds
}

export interface AudioManifest {
  provider: string;
  voice: string;
  segments: AudioSegment[];
  totalDuration: number;
  generatedAt: string;
}

async function openaiTts(text: string, outFile: string, model: string, voice: string, instructions?: string): Promise<void> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    // `instructions` steers delivery (tone/pacing/emotion) on gpt-4o-mini-tts
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3", ...(instructions ? { instructions } : {}) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

/** macOS `say` -> aiff -> m4a (Remotion-playable), no external deps. */
function sayTts(text: string, outFile: string): void {
  const aiff = outFile.replace(/\.[^.]+$/, ".aiff");
  execFileSync("/usr/bin/say", ["-o", aiff, text]);
  execFileSync("/usr/bin/afconvert", ["-f", "m4af", "-d", "aac", aiff, outFile]);
  fs.rmSync(aiff, { force: true });
}

const DIA_SCRIPT = path.join(VIDEO_ROOT, "pipeline", "dia_tts.py");

/** Is a Python env with the `dia` package importable? Cheap probe, ~1s. */
function diaAvailable(cfg: VideoConfig): boolean {
  const py = cfg.voice.dia?.pythonBin || "python3";
  try {
    execFileSync(py, ["-c", "import dia"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Synthesize every segment in one Dia process (the model loads once). Writes each
 * segment's mp3 in place; throws if the Python side fails so the caller can fall back.
 */
function diaTts(jobs: { id: string; text: string; outFile: string }[], cfg: VideoConfig): void {
  const py = cfg.voice.dia?.pythonBin || "python3";
  const jobFile = path.join(path.dirname(jobs[0].outFile), "dia_job.json");
  writeJson(jobFile, {
    model: cfg.voice.dia?.model ?? "nari-labs/Dia-1.6B-0626",
    device: cfg.voice.dia?.device ?? "auto",
    seed: cfg.voice.dia?.seed,
    segments: jobs,
  });
  execFileSync(py, [DIA_SCRIPT, jobFile], { stdio: "inherit" });
  fs.rmSync(jobFile, { force: true });
}

async function main() {
  loadEnv();
  const cfg = loadConfig();
  const week = isoWeekId();
  const dir = episodeDir(week);
  const script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  if (!script) throw new Error("script.json missing — run the script stage first");

  const audioDir = path.join(dir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  // Resolve the provider, degrading when its prerequisites are missing so the
  // pipeline always produces audio.
  let provider = cfg.voice.provider;
  if (provider === "dia" && !diaAvailable(cfg)) {
    const next = process.env.OPENAI_API_KEY ? "openai" : cfg.voice.fallbackProvider;
    console.warn(`[voice] Dia not importable (need a Python env with the 'dia' package — see video/README.md) — falling back to '${next}'`);
    provider = next;
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    provider = cfg.voice.fallbackProvider;
    console.warn(`[voice] OPENAI_API_KEY not set — falling back to '${provider}' (add the key to .env.local for the real voice)`);
  }

  const segments: AudioSegment[] = [];

  if (provider === "dia") {
    // One process for all segments — Dia's model load is the expensive part.
    const jobs = script.segments.map((seg) => ({ id: seg.id, text: seg.voiceover, outFile: path.join(audioDir, `${seg.id}.mp3`) }));
    diaTts(jobs, cfg);
    for (const j of jobs) {
      const duration = audioDuration(j.outFile);
      segments.push({ id: j.id, file: path.relative(dir, j.outFile), duration });
      console.log(`[voice] ${j.id}: ${duration.toFixed(1)}s (dia)`);
    }
  } else {
    for (const seg of script.segments) {
      const ext = provider === "openai" ? "mp3" : "m4a";
      const file = path.join(audioDir, `${seg.id}.${ext}`);
      if (provider === "openai") {
        await openaiTts(seg.voiceover, file, cfg.voice.model, cfg.voice.voice, cfg.voice.instructions);
      } else if (provider === "say") {
        sayTts(seg.voiceover, file);
      } else {
        throw new Error(`Unknown TTS provider '${provider}'`);
      }
      const duration = audioDuration(file);
      segments.push({ id: seg.id, file: path.relative(dir, file), duration });
      console.log(`[voice] ${seg.id}: ${duration.toFixed(1)}s (${provider})`);
    }
  }

  const voiceLabel = provider === "dia" ? (cfg.voice.dia?.model ?? "dia") : provider === "openai" ? cfg.voice.voice : "system";
  const manifest: AudioManifest = {
    provider,
    voice: voiceLabel,
    segments,
    totalDuration: segments.reduce((a, s) => a + s.duration, 0),
    generatedAt: new Date().toISOString(),
  };
  writeJson(path.join(audioDir, "manifest.json"), manifest);
  console.log(`[voice] total ${(manifest.totalDuration / 60).toFixed(1)} min -> audio/manifest.json`);
}

main().catch((err) => {
  console.error("[voice] FAILED:", err.message ?? err);
  process.exit(1);
});
