// Orchestrator: runs the whole weekly episode pipeline in order.
//   npm run episode                 -> snapshot .. render (upload only with --upload)
//   npm run episode -- --upload     -> include the YouTube draft upload
//   npm run episode -- --only voice -> run a single stage
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freeDiskGb, isoWeekId, loadConfig } from "./util.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const upload = args.includes("--upload");

const STAGES = ["snapshot", "capture", "script", "broll", "voice", "subtitles", "render", "thumbnail", ...(upload ? ["publish"] : [])];
const list = only ? [only] : STAGES;

// Preflight the disk BEFORE any work — the render stage needs headroom, and there's
// no point paying for the OpenAI voice or spending minutes on capture/render if the
// machine can't finish. Fail fast with an actionable message.
if (list.includes("render")) {
  const cfg = loadConfig();
  const free = freeDiskGb();
  if (free < cfg.render.minFreeDiskGb) {
    console.error(`Not enough disk to render: ${free.toFixed(1)} GB free, need ${cfg.render.minFreeDiskGb} GB.`);
    console.error(`Free some space and re-run — stopping now so nothing (incl. the paid voice) is wasted.`);
    process.exit(1);
  }
}

console.log(`=== Episode ${isoWeekId()} — stages: ${list.join(" -> ")} ===\n`);
const OPTIONAL = new Set(["capture", "broll"]); // garnish stages — scenes fall back to animated looks
for (const stage of list) {
  const t0 = Date.now();
  console.log(`--- ${stage} ---`);
  try {
    execFileSync(process.execPath, ["--import", "tsx", path.join(__dirname, `${stage}.ts`)], { stdio: "inherit" });
  } catch (err) {
    if (OPTIONAL.has(stage) && !only) {
      console.warn(`--- ${stage} failed (non-fatal), continuing ---\n`);
      continue;
    }
    throw err;
  }
  console.log(`--- ${stage} ok (${((Date.now() - t0) / 1000).toFixed(0)}s) ---\n`);
}
console.log(upload ? "Episode uploaded as unlisted draft — review in YouTube Studio." : "Episode rendered. Add --upload to also push the YouTube draft.");
