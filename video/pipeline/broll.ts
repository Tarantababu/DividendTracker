// Stage 2b: stock B-roll from Pexels (free API, license covers monetized YouTube,
// no attribution required). Clips land in a shared library (video/assets/broll)
// keyed by query slug so they're reused across episodes, then get HARDLINKED into
// the episode folder (same volume -> zero extra disk) for Remotion's publicDir.
// Optional stage: no PEXELS_API_KEY or no matches -> scenes keep their animated look.
import fs from "node:fs";
import path from "node:path";
import { episodeDir, isoWeekId, loadConfig, loadEnv, readJson, writeJson, VIDEO_ROOT, freeDiskGb } from "./util.ts";
import type { EpisodeScript, Segment } from "./script.ts";

const LIBRARY = path.join(VIDEO_ROOT, "assets", "broll");

// Fallback queries when the script predates brollQuery or says nothing useful
const DEFAULT_QUERY: Record<string, string> = {
  title: "city skyline dusk",
  macro: "stock market screens",
  news: "newspaper printing press",
  dividends: "coins money slow",
  outro: "sunset walking street",
};

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

interface PexelsVideo {
  video_files: Array<{ width: number; height: number; link: string; file_type: string }>;
}

async function searchAndDownload(query: string, apiKey: string, maxMb: number, orientation: string): Promise<string | null> {
  const file = path.join(LIBRARY, `${slug(query)}.mp4`);
  if (fs.existsSync(file)) return file; // library hit — free

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=${orientation}&size=medium`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    console.warn(`[broll] Pexels search failed for "${query}" (HTTP ${res.status})`);
    return null;
  }
  const data = (await res.json()) as { videos?: PexelsVideo[] };
  for (const video of data.videos ?? []) {
    // Smallest HD-ish rendition keeps the low-disk machine happy
    const candidates = (video.video_files ?? [])
      .filter((f) => f.file_type === "video/mp4" && f.width >= 1280 && f.width <= 1920)
      .sort((a, b) => a.width - b.width);
    for (const f of candidates) {
      try {
        const dl = await fetch(f.link);
        if (!dl.ok) continue;
        const buf = Buffer.from(await dl.arrayBuffer());
        if (buf.length > maxMb * 1024 * 1024) continue; // too heavy, try next rendition
        fs.mkdirSync(LIBRARY, { recursive: true });
        fs.writeFileSync(file, buf);
        return file;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function main() {
  loadEnv();
  const cfg = loadConfig();
  if (!cfg.broll.enabled) {
    console.log("[broll] disabled in config — skipping");
    return;
  }
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn("[broll] PEXELS_API_KEY not set in .env.local — get a free key at pexels.com/api, skipping B-roll");
    return;
  }
  if (freeDiskGb() < 2) {
    console.warn("[broll] low disk — skipping downloads, using whatever the library already has");
  }

  const week = isoWeekId();
  const dir = episodeDir(week);
  const script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  if (!script) throw new Error("script.json missing — run the script stage first");

  const episodeBroll = path.join(dir, "broll");
  fs.mkdirSync(episodeBroll, { recursive: true });

  const map: Record<string, string> = {}; // segment id -> episode-relative path
  for (const seg of script.segments as Segment[]) {
    const q = seg.brollQuery && seg.brollQuery !== "none" ? seg.brollQuery : DEFAULT_QUERY[seg.scene];
    if (!q) continue;
    if (seg.onScreen.screenshot) continue; // tool pans stay clean
    const libFile = freeDiskGb() < 2 && !fs.existsSync(path.join(LIBRARY, `${slug(q)}.mp4`)) ? null : await searchAndDownload(q, apiKey, cfg.broll.maxClipMb, cfg.broll.orientation);
    if (!libFile) continue;
    const target = path.join(episodeBroll, path.basename(libFile));
    if (!fs.existsSync(target)) {
      try {
        fs.linkSync(libFile, target); // hardlink: no extra disk
      } catch {
        fs.copyFileSync(libFile, target);
      }
    }
    map[seg.id] = path.join("broll", path.basename(libFile));
    console.log(`[broll] ${seg.id} (${seg.scene}) <- "${q}"`);
  }
  writeJson(path.join(episodeBroll, "manifest.json"), { map, generatedAt: new Date().toISOString() });
  console.log(`[broll] ${Object.keys(map).length} clips -> broll/manifest.json`);
}

main().catch((err) => {
  console.error("[broll] FAILED:", err.message ?? err);
  process.exit(1);
});
