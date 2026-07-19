import { NextRequest, NextResponse } from "next/server";
import { syncDividends, T212Error } from "@/lib/t212";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    const payload = await syncDividends(force);
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
