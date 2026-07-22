// Stage 5: Remotion render -> episodes/<week>/episode.mp4. Remotion runs in a
// headless browser (no fs), so all episode JSON goes in as input props and the
// episode folder is served as publicDir so <Audio> can load the voiceover files.
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { episodeDir, freeDiskGb, isoWeekId, loadConfig, readJson, VIDEO_ROOT } from "./util.ts";
import type { EpisodeData } from "./snapshot.ts";
import type { EpisodeScript } from "./script.ts";
import type { AudioManifest } from "./voice.ts";

async function main() {
  const cfg = loadConfig();
  const week = isoWeekId();
  const dir = episodeDir(week);

  const data = readJson<EpisodeData>(path.join(dir, "data.json"));
  const script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  const manifest = readJson<AudioManifest>(path.join(dir, "audio", "manifest.json"));
  if (!data || !script || !manifest) throw new Error("data/script/audio missing — run earlier stages first");

  const free = freeDiskGb();
  if (free < cfg.render.minFreeDiskGb) {
    throw new Error(`Only ${free.toFixed(1)} GB free — need ${cfg.render.minFreeDiskGb} GB to render safely. Free some space first.`);
  }

  console.log("[render] bundling Remotion project…");
  const bundled = await bundle({
    entryPoint: path.join(VIDEO_ROOT, "remotion", "index.ts"),
    publicDir: dir, // staticFile("audio/…") resolves inside the episode folder
  });

  const shots = readJson<{ captured: Record<string, string> }>(path.join(dir, "shots", "manifest.json"))?.captured ?? {};
  const broll = readJson<{ map: Record<string, string> }>(path.join(dir, "broll", "manifest.json"))?.map ?? {};

  // Music bed: first audio file in video/assets/music/, hardlinked into the episode
  // (drop a track from the YouTube Audio Library there — Content-ID safe).
  let music: string | undefined;
  const musicDir = path.join(VIDEO_ROOT, "assets", "music");
  try {
    const track = fs.readdirSync(musicDir).find((f) => /\.(mp3|m4a|wav)$/i.test(f));
    if (track) {
      const target = path.join(dir, track);
      if (!fs.existsSync(target)) {
        try {
          fs.linkSync(path.join(musicDir, track), target);
        } catch {
          fs.copyFileSync(path.join(musicDir, track), target);
        }
      }
      music = track;
      console.log(`[render] music bed: ${track} @ ${cfg.music.volume}`);
    }
  } catch {
    /* no music folder — silent bed */
  }

  const inputProps = { data, script, manifest, channel: cfg.channelName, shots, broll, music, musicVolume: cfg.music.volume };
  const composition = await selectComposition({ serveUrl: bundled, id: "episode", inputProps });
  const scaled = { ...composition, width: cfg.render.width, height: cfg.render.height, fps: cfg.render.fps };

  const out = path.join(dir, "episode.mp4");
  console.log(`[render] ${scaled.width}x${scaled.height}@${scaled.fps} ~${Math.round(composition.durationInFrames / composition.fps)}s -> episode.mp4`);
  let lastPct = -1;
  await renderMedia({
    composition: scaled,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: out,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`${pct}% `);
      }
    },
  });
  process.stdout.write("\n");

  // The bundle is a temp webpack build — reclaim the space immediately (low-disk machine)
  fs.rmSync(bundled, { recursive: true, force: true });
  const size = fs.statSync(out).size / 1e6;
  console.log(`[render] done: episode.mp4 (${size.toFixed(0)} MB)`);
}

main().catch((err) => {
  console.error("[render] FAILED:", err.message ?? err);
  process.exit(1);
});
