// Stage 3: voiceover per segment. Primary: OpenAI TTS (gpt-4o-mini-tts). Fallback:
// macOS `say` (robotic but free) so the pipeline stays testable without a key.
// Output: episodes/<week>/audio/<segment>.mp3|m4a + audio/manifest.json with durations.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { audioDuration, episodeDir, isoWeekId, loadConfig, loadEnv, readJson, writeJson } from "./util.ts";
import type { EpisodeScript } from "./script.ts";

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

async function main() {
  loadEnv();
  const cfg = loadConfig();
  const week = isoWeekId();
  const dir = episodeDir(week);
  const script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  if (!script) throw new Error("script.json missing — run the script stage first");

  const audioDir = path.join(dir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  let provider = cfg.voice.provider;
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    provider = cfg.voice.fallbackProvider;
    console.warn(`[voice] OPENAI_API_KEY not set — falling back to '${provider}' (add the key to .env.local for the real voice)`);
  }

  const segments: AudioSegment[] = [];
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

  const manifest: AudioManifest = {
    provider,
    voice: provider === "openai" ? cfg.voice.voice : "system",
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
