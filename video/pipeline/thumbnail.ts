// Stage 5b: render the YouTube thumbnail still (total value + weekly P/L)
// -> episodes/<week>/thumbnail.png. Same bundle mechanics as the video render.
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { episodeDir, isoWeekId, loadConfig, readJson, VIDEO_ROOT } from "./util.ts";
import type { EpisodeData } from "./snapshot.ts";
import type { EpisodeScript } from "./script.ts";

async function main() {
  const cfg = loadConfig();
  const week = isoWeekId();
  const dir = episodeDir(week);

  const data = readJson<EpisodeData>(path.join(dir, "data.json"));
  const script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  if (!data || !script) throw new Error("data/script missing — run earlier stages first");
  const shots = readJson<{ captured: Record<string, string> }>(path.join(dir, "shots", "manifest.json"))?.captured ?? {};

  const bundled = await bundle({ entryPoint: path.join(VIDEO_ROOT, "remotion", "index.ts"), publicDir: dir });
  const inputProps = { data, script, channel: cfg.channelName, shots };
  const composition = await selectComposition({ serveUrl: bundled, id: "thumbnail", inputProps });

  const out = path.join(dir, "thumbnail.png");
  await renderStill({ composition, serveUrl: bundled, output: out, inputProps });
  fs.rmSync(bundled, { recursive: true, force: true });
  console.log(`[thumbnail] ${composition.width}x${composition.height} -> thumbnail.png (value ${data.portfolio.totalValue}, week ${data.portfolio.weekChange})`);
}

main().catch((err) => {
  console.error("[thumbnail] FAILED:", err.message ?? err);
  process.exit(1);
});
