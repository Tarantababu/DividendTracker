import { NextRequest, NextResponse } from "next/server";
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/** Free space on / in GB (MB precision). Returns null if df is unavailable. */
function freeDiskGb(): number | null {
  try {
    const out = execFileSync("/bin/df", ["-m", "/"], { encoding: "utf8" });
    const availMb = Number((out.trim().split("\n").pop() ?? "").split(/\s+/)[3]);
    return Number.isFinite(availMb) ? availMb / 1024 : null;
  } catch {
    return null;
  }
}

// Kicks off the full episode pipeline (snapshot → … → render, optionally → upload)
// as a background child process and tracks its progress in memory. The POST returns
// immediately; the page polls GET for the live stage + log tail. Rendering is local
// only — episodes and the pipeline's node_modules aren't deployed to Vercel.

interface Job {
  week: string;
  upload: boolean;
  running: boolean;
  startedAt: string;
  finishedAt?: string;
  code?: number | null;
  stage: string | null;
  log: string[]; // tail, capped
  error?: string;
}

// Module-level: survives across requests within the one dev-server process.
let job: Job | null = null;
const LOG_CAP = 240;

function isoWeekId(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function publicView(j: Job) {
  return {
    week: j.week,
    upload: j.upload,
    running: j.running,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt ?? null,
    code: j.code ?? null,
    stage: j.stage,
    ok: j.running ? null : j.code === 0,
    error: j.error ?? null,
    log: j.log.slice(-40), // enough for the UI; full log stays server-side
  };
}

export async function GET() {
  return NextResponse.json({ job: job ? publicView(job) : null });
}

export async function POST(req: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: "LOCAL_ONLY", message: "Video generation runs on your local machine (it needs the dev server, Puppeteer and Remotion). The deployed site is a viewer — run it where the app is running locally." },
      { status: 501 },
    );
  }
  if (job?.running) {
    return NextResponse.json({ error: "ALREADY_RUNNING", message: `An episode is already generating (${job.week}, stage: ${job.stage ?? "starting"}).`, job: publicView(job) }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { upload?: boolean };
  const upload = !!body.upload;

  const videoRoot = path.join(process.cwd(), "video");
  const tsxBin = path.join(videoRoot, "node_modules", ".bin", "tsx");
  if (!fs.existsSync(tsxBin)) {
    return NextResponse.json(
      { error: "NOT_SET_UP", message: "video/node_modules is missing — run `cd video && npm install` once, then try again." },
      { status: 428 },
    );
  }

  // Preflight disk — the render stage needs headroom. Fail before spending minutes
  // (and the paid TTS) on a run that can't finish. Threshold from video/config.json.
  let minFreeGb = 1.2;
  try {
    minFreeGb = JSON.parse(fs.readFileSync(path.join(videoRoot, "config.json"), "utf8"))?.render?.minFreeDiskGb ?? 1.2;
  } catch {
    /* keep default */
  }
  const freeGb = freeDiskGb();
  if (freeGb != null && freeGb < minFreeGb) {
    return NextResponse.json(
      { error: "LOW_DISK", message: `Not enough disk to render: ${freeGb.toFixed(1)} GB free, need ${minFreeGb} GB. Free some space and try again.` },
      { status: 507 },
    );
  }

  const week = isoWeekId();
  job = { week, upload, running: true, startedAt: new Date().toISOString(), stage: null, code: null, log: [] };
  const j = job;

  const args = [path.join(videoRoot, "pipeline", "run.ts"), ...(upload ? ["--upload"] : [])];
  const child = spawn(tsxBin, args, { cwd: videoRoot, env: process.env });

  const ingest = (buf: Buffer) => {
    for (const raw of buf.toString().split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (!line) continue;
      j.log.push(line);
      if (j.log.length > LOG_CAP) j.log.splice(0, j.log.length - LOG_CAP);
      // run.ts prints "--- <stage> ---" as it enters each stage.
      const m = line.match(/^---\s+([a-z]+)\s+---$/);
      if (m) j.stage = m[1];
    }
  };
  child.stdout.on("data", ingest);
  child.stderr.on("data", ingest);
  child.on("error", (err) => {
    j.running = false;
    j.finishedAt = new Date().toISOString();
    j.code = 1;
    j.error = err.message;
  });
  child.on("close", (code) => {
    j.running = false;
    j.finishedAt = new Date().toISOString();
    j.code = code;
    j.stage = code === 0 ? "done" : j.stage;
  });

  return NextResponse.json({ ok: true, job: publicView(job) });
}
