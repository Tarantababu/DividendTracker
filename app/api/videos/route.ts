import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const EPISODES_DIR = path.join(process.cwd(), "video", "episodes");

export interface EpisodeInfo {
  week: string;
  title: string | null;
  description: string | null;
  thumbnailText: string | null;
  durationSec: number | null;
  sizeMb: number | null;
  hasVideo: boolean;
  hasThumbnail: boolean;
  voice: string | null;
  studioUrl: string | null; // set once uploaded to YouTube
  generatedAt: string | null;
}

/** True when Google OAuth is fully set up (secret + cached token) so the app can upload. */
async function checkAuthReady(): Promise<boolean> {
  const secrets = path.join(process.cwd(), "video", "secrets");
  try {
    await fs.access(path.join(secrets, "client_secret.json"));
    await fs.access(path.join(secrets, "token.json"));
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const authReady = await checkAuthReady();
  let weeks: string[] = [];
  try {
    weeks = (await fs.readdir(EPISODES_DIR)).filter((d) => /^\d{4}-W\d{2}$/.test(d)).sort().reverse();
  } catch {
    return NextResponse.json({ episodes: [], authReady });
  }

  const episodes: EpisodeInfo[] = [];
  for (const week of weeks) {
    const dir = path.join(EPISODES_DIR, week);
    const readJson = async (f: string) => {
      try {
        return JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
      } catch {
        return null;
      }
    };
    const [script, manifest, upload] = await Promise.all([readJson("script.json"), readJson("audio/manifest.json"), readJson("upload.json")]);
    let sizeMb: number | null = null;
    let hasVideo = false;
    try {
      const st = await fs.stat(path.join(dir, "episode.mp4"));
      sizeMb = Math.round(st.size / 1e5) / 10;
      hasVideo = true;
    } catch {
      /* not rendered yet */
    }
    let hasThumbnail = false;
    try {
      await fs.access(path.join(dir, "thumbnail.png"));
      hasThumbnail = true;
    } catch {
      /* no thumbnail yet */
    }
    episodes.push({
      week,
      hasThumbnail,
      title: script?.title ?? null,
      description: script?.description ?? null,
      thumbnailText: script?.thumbnailText ?? null,
      durationSec: manifest?.totalDuration ? Math.round(manifest.totalDuration) : null,
      sizeMb,
      hasVideo,
      voice: manifest?.provider ?? null,
      studioUrl: upload?.studioUrl ?? null,
      generatedAt: script?.generatedAt ?? null,
    });
  }
  return NextResponse.json({ episodes, authReady });
}
