// Stage 1b: real screenshots of the tool's pages -> episodes/<week>/shots/*.png.
// Reuses Remotion's Chrome Headless Shell via puppeteer-core, so no extra browser
// download. The dev server must be running (same requirement as the snapshot).
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { episodeDir, isoWeekId, loadConfig, resolveBaseUrl, VIDEO_ROOT, writeJson } from "./util.ts";

/** Find the Chrome Headless Shell Remotion downloaded on first render. */
function findChrome(): string {
  const roots = [path.join(VIDEO_ROOT, "node_modules", ".remotion"), path.join(process.env.HOME ?? "", ".remotion")];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name === "chrome-headless-shell") return p;
      }
    }
  }
  throw new Error("Chrome Headless Shell not found — run a render once (npm run render) so Remotion downloads it.");
}

async function main() {
  const cfg = loadConfig();
  const base = await resolveBaseUrl(cfg);
  const week = isoWeekId();
  const dir = episodeDir(week);
  const shotsDir = path.join(dir, "shots");
  fs.mkdirSync(shotsDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
    // Tall viewport: screenshot scenes pan vertically down the page (Carlson-style)
    defaultViewport: { width: 1440, height: 3000, deviceScaleFactor: 2 },
  });

  const captured: Record<string, string> = {};
  try {
    const page = await browser.newPage();
    for (const [key, route] of Object.entries(cfg.screenshots)) {
      const url = `${base}${route}`;
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
        // Let charts/animations settle (recharts renders after data fetches)
        await new Promise((r) => setTimeout(r, 4_000));
        const file = path.join(shotsDir, `${key}.png`);
        await page.screenshot({ path: file as `${string}.png`, fullPage: false });
        captured[key] = `shots/${key}.png`;
        console.log(`[capture] ${key} <- ${route}`);
      } catch (err) {
        console.warn(`[capture] ${key} failed (${(err as Error).message}) — scene falls back to animated`);
      }
    }
  } finally {
    await browser.close();
  }
  writeJson(path.join(shotsDir, "manifest.json"), { captured, capturedAt: new Date().toISOString() });
  console.log(`[capture] ${Object.keys(captured).length} screenshots -> shots/`);
}

main().catch((err) => {
  console.error("[capture] FAILED:", err.message ?? err);
  process.exit(1);
});
