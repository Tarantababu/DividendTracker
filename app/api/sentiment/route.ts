import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { NewsItem, Sentiment } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TTL_MS = 60 * 60 * 1000;

interface SentimentRequest {
  symbol: string;
  name: string;
  headlines: NewsItem[];
}

interface CacheEntry {
  at: number;
  sentiment: Sentiment;
}
const cache: Map<string, CacheEntry> = ((globalThis as Record<string, unknown>).__sentimentCache ??=
  new Map()) as Map<string, CacheEntry>;

const SCHEMA = {
  type: "object",
  properties: {
    stance: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    score: {
      type: "number",
      description: "Signed strength from -1 (strongly bearish) to 1 (strongly bullish); 0 = neutral/mixed.",
    },
    summary: {
      type: "string",
      description: "Two sentences max: the dominant narrative in these headlines and what it implies for the stock.",
    },
  },
  required: ["stance", "score", "summary"],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "MISSING_ANTHROPIC_KEY", message: "Add ANTHROPIC_API_KEY to .env.local and restart the dev server." },
      { status: 428 },
    );
  }

  let body: SentimentRequest;
  try {
    body = (await req.json()) as SentimentRequest;
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid request body" }, { status: 400 });
  }
  const headlines = (body.headlines ?? []).slice(0, 15);
  if (!body.symbol || headlines.length === 0) {
    return NextResponse.json({ error: "BAD_REQUEST", message: "Need symbol and at least one headline" }, { status: 400 });
  }

  const key = body.symbol + "|" + headlines.map((h) => h.title).join("§");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ sentiment: hit.sentiment, cached: true });

  const list = headlines
    .map((h) => `- [${h.source}, ${h.publishedAt.slice(0, 10)}] ${h.title}`)
    .join("\n");

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system:
        "You are a sell-side news analyst. Given recent headlines about one stock, judge the near-term sentiment they convey for that stock. Weigh company-specific news (earnings, guidance, dividends, litigation, ratings) above macro noise; recent headlines above stale ones. Be conservative: pick 'neutral' when the picture is mixed or the headlines are routine coverage.",
      messages: [
        {
          role: "user",
          content: `Stock: ${body.name || body.symbol} (${body.symbol})\n\nRecent headlines:\n${list}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "REFUSED", message: "Model declined to score these headlines." }, { status: 502 });
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text) as Omit<Sentiment, "generatedAt">;
    const sentiment: Sentiment = {
      stance: parsed.stance,
      score: Math.max(-1, Math.min(1, parsed.score)),
      summary: parsed.summary,
      generatedAt: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), sentiment });
    return NextResponse.json({ sentiment });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "ANTHROPIC_AUTH", message: "Anthropic rejected the API key — check ANTHROPIC_API_KEY in .env.local." }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "ANTHROPIC_RATE_LIMIT", message: "Anthropic rate limit hit — wait a minute and try again." }, { status: 502 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: "ANTHROPIC_ERROR", message: `Claude API error (${err.status}): ${err.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
