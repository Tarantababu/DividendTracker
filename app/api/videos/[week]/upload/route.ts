import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // a 40MB upload can take a while

// Trigger the YouTube draft upload for one episode by running the pipeline's
// publish stage headless. Requires the one-time terminal OAuth (loopback flow)
// to have been completed — until then this returns 428 with instructions.
export async function POST(req: NextRequest, ctx: { params: Promise<{ week: string }> }) {
  const { week } = await ctx.params;
  if (!/^\d{4}-W\d{2}$/.test(week)) return NextResponse.json({ error: "BAD_WEEK" }, { status: 400 });

  const videoRoot = path.join(process.cwd(), "video");
  const episode = path.join(videoRoot, "episodes", week);
  try {
    await fs.access(path.join(episode, "episode.mp4"));
  } catch {
    return NextResponse.json({ error: "NOT_RENDERED", message: "episode.mp4 missing — render the episode first." }, { status: 409 });
  }

  const tsxBin = path.join(videoRoot, "node_modules", ".bin", "tsx");
  const result = await new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      tsxBin,
      [path.join(videoRoot, "pipeline", "publish.ts"), week, "--headless"],
      { cwd: videoRoot, timeout: 9 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code ?? 1) : err ? 1 : 0;
        resolve({ code, out: `${stdout}\n${stderr}`.trim() });
      },
    );
  });

  if (result.code === 3) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "One-time Google authorization needed: run `cd video && npm run publish` in a terminal, approve in the browser, then this button works." },
      { status: 428 },
    );
  }
  if (result.code !== 0) {
    const tail = result.out.split("\n").slice(-6).join("\n");
    return NextResponse.json({ error: "UPLOAD_FAILED", message: tail || "Upload failed — check the terminal logs." }, { status: 502 });
  }

  // publish.ts wrote upload.json on success
  try {
    const upload = JSON.parse(await fs.readFile(path.join(episode, "upload.json"), "utf8"));
    return NextResponse.json({ ok: true, ...upload });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
