import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ week: string }> }) {
  const { week } = await ctx.params;
  if (!/^\d{4}-W\d{2}$/.test(week)) return NextResponse.json({ error: "BAD_WEEK" }, { status: 400 });
  const file = path.join(process.cwd(), "video", "episodes", week, "thumbnail.png");
  try {
    const buf = fs.readFileSync(file);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}
