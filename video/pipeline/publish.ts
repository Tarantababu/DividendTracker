// Stage 6: upload episode.mp4 to YouTube as an UNLISTED draft with the generated
// metadata, custom thumbnail + captions. Never publishes publicly — you review in
// YouTube Studio.
//
// One-time setup:
// 1. console.cloud.google.com -> create project -> enable "YouTube Data API v3"
// 2. OAuth consent screen (External, add yourself as test user)
// 3. Credentials -> OAuth client ID -> Desktop app -> download JSON
//    -> save as video/secrets/client_secret.json
// 4. Run `npm run publish` once in a terminal: it opens Google consent in the
//    browser and catches the redirect on localhost (loopback flow). The token is
//    cached; after that the app's Upload button works with no terminal involved.
//
// Usage: tsx publish.ts [YYYY-Www] [--headless]
//   --headless: never start the interactive consent flow (used by the app's
//   Upload button). Exits with code 3 when auth is missing.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { youtube } from "@googleapis/youtube";
import { OAuth2Client } from "google-auth-library";
import { episodeDir, isoWeekId, readJson, VIDEO_ROOT, writeJson } from "./util.ts";
import type { EpisodeScript } from "./script.ts";

const SECRETS_DIR = path.join(VIDEO_ROOT, "secrets");
const CLIENT_SECRET = path.join(SECRETS_DIR, "client_secret.json");
const TOKEN_FILE = path.join(SECRETS_DIR, "token.json");
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"];

const AUTH_EXIT_CODE = 3; // the app's upload route maps this to "run OAuth in a terminal first"

interface InstalledSecret {
  client_id: string;
  client_secret: string;
}

function readSecret(): InstalledSecret | null {
  const raw = readJson<{ installed?: InstalledSecret; web?: InstalledSecret }>(CLIENT_SECRET);
  return raw?.installed ?? raw?.web ?? null;
}

/** Google killed the oob flow — use loopback: catch the consent redirect locally. */
async function loopbackConsent(installed: InstalledSecret): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const client = new OAuth2Client(installed.client_id, installed.client_secret, redirectUri);
      const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

      server.on("request", async (req, res) => {
        try {
          const code = new URL(req.url ?? "", redirectUri).searchParams.get("code");
          if (!code) {
            res.end("No code — try again.");
            return;
          }
          res.end("Authorized — you can close this tab and return to the terminal.");
          server.close();
          const { tokens } = await client.getToken(code);
          resolve(tokens as Record<string, unknown>);
        } catch (err) {
          server.close();
          reject(err);
        }
      });

      console.log(`\nAuthorize the upload — opening Google consent (or open this URL yourself):\n\n${url}\n`);
      execFile("/usr/bin/open", [url], () => {});
    });
    server.on("error", reject);
  });
}

async function getAuth(headless: boolean): Promise<OAuth2Client> {
  const installed = readSecret();
  if (!installed) {
    console.error(`No ${path.relative(VIDEO_ROOT, CLIENT_SECRET)} — see the setup comment at the top of publish.ts.`);
    process.exit(AUTH_EXIT_CODE);
  }
  const client = new OAuth2Client(installed.client_id, installed.client_secret);
  const token = readJson<Record<string, unknown>>(TOKEN_FILE);
  if (token) {
    client.setCredentials(token);
    return client;
  }
  if (headless) {
    console.error("Not authorized yet — run `cd video && npm run publish` once in a terminal to complete Google consent.");
    process.exit(AUTH_EXIT_CODE);
  }
  const tokens = await loopbackConsent(installed);
  client.setCredentials(tokens);
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  writeJson(TOKEN_FILE, tokens);
  console.log("Token cached — future uploads (including the app's Upload button) need no terminal.");
  return client;
}

async function main() {
  const args = process.argv.slice(2);
  const headless = args.includes("--headless");
  const weekArg = args.find((a) => /^\d{4}-W\d{2}$/.test(a));
  const week = weekArg ?? isoWeekId();
  const dir = episodeDir(week);

  const script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  const videoFile = path.join(dir, "episode.mp4");
  if (!script || !fs.existsSync(videoFile)) throw new Error(`script.json / episode.mp4 missing for ${week} — run earlier stages first`);

  const auth = await getAuth(headless);
  const yt = youtube({ version: "v3", auth });

  console.log(`[publish] uploading "${script.title}" (${week}) as unlisted draft…`);
  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: script.title.slice(0, 100),
        description: script.description,
        tags: script.tags,
        categoryId: "27", // Education
        defaultLanguage: "en",
      },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(videoFile) },
  });
  const videoId = res.data.id;
  console.log(`[publish] uploaded: https://studio.youtube.com/video/${videoId}/edit`);

  // Custom thumbnail (needs a phone-verified YouTube account — non-fatal if not)
  const thumb = path.join(dir, "thumbnail.png");
  let thumbnailSet = false;
  if (videoId && fs.existsSync(thumb)) {
    try {
      await yt.thumbnails.set({ videoId, media: { body: fs.createReadStream(thumb) } });
      thumbnailSet = true;
      console.log("[publish] thumbnail set");
    } catch (err) {
      console.warn("[publish] thumbnail failed (account not verified for custom thumbnails?):", (err as Error).message);
    }
  }

  // Captions (best effort)
  const srt = path.join(dir, "episode.srt");
  if (videoId && fs.existsSync(srt)) {
    try {
      await yt.captions.insert({
        part: ["snippet"],
        requestBody: { snippet: { videoId, language: "en", name: "English" } },
        media: { body: fs.createReadStream(srt) },
      });
      console.log("[publish] captions attached");
    } catch (err) {
      console.warn("[publish] caption upload failed (non-fatal):", (err as Error).message);
    }
  }
  writeJson(path.join(dir, "upload.json"), {
    videoId,
    uploadedAt: new Date().toISOString(),
    studioUrl: `https://studio.youtube.com/video/${videoId}/edit`,
    watchUrl: `https://youtu.be/${videoId}`,
    thumbnailSet,
  });
  console.log("[publish] done — review and publish in YouTube Studio.");
}

main().catch((err) => {
  console.error("[publish] FAILED:", err.message ?? err);
  process.exit(1);
});
