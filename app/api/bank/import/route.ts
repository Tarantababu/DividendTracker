import { NextRequest, NextResponse } from "next/server";
import { importTransactions, BankError } from "@/lib/bank";
import { parseN26Csv, CsvError } from "@/lib/n26csv";
import { normalize, summarize } from "@/lib/budget";

export const dynamic = "force-dynamic";

// Import an N26 transactions CSV — the no-signup path. Accepts either a multipart
// file upload (field "file") or the raw CSV text as the request body.
export async function POST(req: NextRequest) {
  try {
    let text = "";
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file && typeof file !== "string") text = await file.text();
    } else {
      text = await req.text();
    }
    if (!text.trim()) return NextResponse.json({ error: "EMPTY", message: "No CSV content received." }, { status: 400 });

    const rawTx = parseN26Csv(text);
    await importTransactions(rawTx);
    const summary = summarize(normalize(rawTx));
    return NextResponse.json({ imported: rawTx.length, summary });
  } catch (err) {
    if (err instanceof CsvError) return NextResponse.json({ error: "BAD_CSV", message: err.message }, { status: 422 });
    if (err instanceof BankError) return NextResponse.json({ error: err.code, message: err.message }, { status: 502 });
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
