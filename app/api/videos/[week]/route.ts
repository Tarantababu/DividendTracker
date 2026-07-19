import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

export const dynamic = "force-dynamic";

// Stream an episode mp4 with Range support so the <video> element can seek.
export async function GET(req: NextRequest, ctx: { params: Promise<{ week: string }> }) {
  const { week } = await ctx.params;
  if (!/^\d{4}-W\d{2}$/.test(week)) return NextResponse.json({ error: "BAD_WEEK" }, { status: 400 });

  const file = path.join(process.cwd(), "video", "episodes", week, "episode.mp4");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
    const stream = fs.createReadStream(file, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": "video/mp4",
      },
    });
  }
  const stream = fs.createReadStream(file);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: { "Content-Length": String(stat.size), "Content-Type": "video/mp4", "Accept-Ranges": "bytes" },
  });
}
