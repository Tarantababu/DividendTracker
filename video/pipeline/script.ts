// Stage 2: episode data -> narrated script via Claude. Structured output, and a
// hard grounding rule: every number in the voiceover must come from data.json.
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { episodeDir, isoWeekId, loadConfig, loadEnv, readJson, writeJson } from "./util.ts";
import type { EpisodeData } from "./snapshot.ts";

export type SceneKind = "title" | "macro" | "news" | "stats" | "chart" | "dividends" | "fire" | "lookthrough" | "pivot" | "outro";

export type ScreenshotKey = "dashboard" | "fire" | "budget" | "signals";

export interface Segment {
  id: string;
  scene: SceneKind;
  voiceover: string;
  visualCue: string; // director's note — what the viewer should see (not spoken)
  brollQuery: string; // 2-3 word stock-footage search ("city skyline dusk"), or "none"
  onScreen: {
    heading: string;
    bullets: string[]; // short display lines, may include the numbers being narrated
    screenshot?: ScreenshotKey | null; // show a live screenshot of the tool behind this segment
  };
}

export interface EpisodeScript {
  title: string;
  description: string;
  tags: string[];
  thumbnailText: string; // <= 4 words, punchy
  segments: Segment[];
  generatedAt: string;
  model: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "YouTube title, <= 90 chars, concrete numbers welcome" },
    description: {
      type: "string",
      description:
        "YouTube description: 2 short paragraphs + a chapter-less summary + the disclaimer. Then a 'This week's numbers' block with the key figures, and a 'Sources' list of 5-8 entries taken VERBATIM from data.sources as 'Title — url' (never invent a link). No hashtag spam.",
    },
    tags: { type: "array", items: { type: "string" } },
    thumbnailText: { type: "string", description: "<= 4 words for the thumbnail, e.g. '+312 € THIS WEEK'" },
    segments: {
      type: "array",
      description: "6 to 9 segments, in the episode-structure order",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          scene: { type: "string", enum: ["title", "macro", "news", "stats", "chart", "dividends", "fire", "lookthrough", "pivot", "outro"] },
          voiceover: { type: "string", description: "Spoken narration for this scene. Natural, first person, no headings, no emoji, NO bracketed cues — this text goes straight to text-to-speech. 40-120 words." },
          visualCue: { type: "string", description: "Director's note in the style of [Visual Cue]: what's on screen, zooms, b-roll ideas. Never spoken." },
          brollQuery: { type: "string", description: "2-3 word stock-footage search for this scene's background mood ('city skyline dusk', 'coins falling slow', 'office people working', 'stock market screens') or 'none' for data-heavy scenes where footage would distract." },
          onScreen: {
            type: "object",
            properties: {
              heading: { type: "string", description: "Short on-screen heading, <= 40 chars" },
              bullets: { type: "array", items: { type: "string" }, description: "Up to 5 short display lines (stat: value pairs work well)" },
              screenshot: { type: "string", enum: ["dashboard", "fire", "budget", "signals", "none"], description: "Show a real screenshot of the tracking tool behind this segment (pick the page that matches the story), or 'none' for the default animated scene. Use screenshots on 2-3 segments max." },
            },
            required: ["heading", "bullets", "screenshot"],
            additionalProperties: false,
          },
        },
        required: ["id", "scene", "voiceover", "visualCue", "brollQuery", "onScreen"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "description", "tags", "thumbnailText", "segments"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are an experienced YouTube scriptwriter specializing in the personal-finance and FIRE niche. You write the weekly episode for a channel documenting one person's REAL journey to financial independence with a dividend-ETF portfolio on Trading212, living in Germany. Every number comes from their actual tracking tool.

TONE & VOICE — the "friend over coffee", anti-guru style:
- Conversational, authentic, slightly self-deprecating. A friend telling you what happened to their money this week — not a financial planner, never a guru. No hype, no clichés, no emoji.
- NO stiff transitions ("Now let's move on to asset allocation"). Use natural pivots ("But here's where things got a little weird…", "Okay, the part I actually care about…").
- Acknowledge the emotional side of money: the itch to check the app on red days, the temptation of cash sitting idle, FOMO on headlines, the absurdity of a 27-year countdown. Feelings first, then the math.
- Be honest about dumb moves and imperfections visible in the data (idle cash, a losing position, a withdrawal). Vulnerability connects; perfection bores. Never invent mistakes that aren't in the data.
- Explain any concept with an everyday analogy (XIRR ≈ "what interest rate my money actually earned, as if it were one big savings account"). One analogy per concept, no lecturing.

PACING & HOOKS:
- NO long intro. The title segment must hook within the first sentence: a burning question, a shocking number from the data, or a relatable struggle. Then one line on why a viewer should care.
- Punchy sentences. Varied length. Short lines land. Then a longer one to breathe.
- End macro/news segments with a pull-through bridge into MY portfolio ("so what did that actually do to my money?").

STRUCTURE (map to these scene kinds, in this order):
1. title — the Hook: burning question / shocking number / relatable struggle + why it matters to the viewer.
2. macro — the Big Picture, part 1: what kind of week the world's markets had. Use 'macroTrends' for real trend context, not just the week's tick: where each index sits in its 52-week range, whether it's above or below its 50/200-day average, and how the 1-month/3-month/1-year picture frames this week. Explain the TRANSMISSION MECHANISM behind the biggest move (why higher yields hit long-duration growth, why a stronger dollar pressures commodities) so the viewer learns the plumbing, not just the number. Then give the emotional read for a dividend investor. Where it adds colour, name a big US or European mover from 'marketMovers' to show which sectors led or lagged — but NEVER imply I own those names.
3. news — the Big Picture, part 2: what happened around MY actual holdings (from holdingsNews) — pick the 2-3 juiciest headlines, name the fund, say why it matters. Bridge into my numbers.
4. stats — the Breakdown begins: portfolio value, the week's REAL market move (deposits stripped out), winners/losers. Story-driven, not a spreadsheet reading.
5. chart — value vs invested: the gap is the market's contribution; tell this week's shape as a story.
6. dividends — what landed, trailing 12 months, monthly average; make it tangible against a real-life expense using only data numbers.
7. fire — the FIRE timeline: Regular + Dividend FIRE ETAs, dividend coverage of expenses; if prevEpisode exists, how the ETA moved. Let the long horizon be felt, not just stated.
8. lookthrough (optional, when data present) — the "hidden portfolio" reveal: the same megacaps stacking up inside several ETFs.
9. pivot — the Lesson of the Week, in two halves. First TEACH one macro concept this week's data genuinely demonstrated (real yields, duration, the dollar's effect on a euro investor, covered-call NAV erosion, breadth, sector rotation…): explain it from first principles in plain English, define any jargon, then tie it to the exact numbers in macroTrends. Second, the honest personal fix drawn strictly from my data (idle cash, concentration, savings rate) and what I'm doing about it before next week. Vary the concept week to week — check prevEpisode so it isn't a repeat.
10. outro — low-pressure CTA in the creator's voice (e.g. invite viewers to drop their own savings rate or FIRE number in the comments — no judgment, keep each other accountable) + verbatim: "None of this is financial advice — I'm sharing my personal journey. Do your own research."

VISUALS:
- voiceover NEVER contains bracketed cues or stage directions — it goes straight to text-to-speech. Flowing sentences, spell out "euros".
- Write for an ENERGETIC, natural delivery: contractions everywhere, direct address ("you know that feeling…"), momentum between sentences, the occasional one-word beat ("Nothing.", "Twelve."). Energy comes from storytelling, not hype words — the anti-guru honesty stays.
- Put every visual idea in visualCue (director's note) and onScreen (heading + bullets; symbols/€ fine there).
- onScreen.screenshot: the channel's signature look is slow pans over the REAL tracking tool in a browser window (Joseph Carlson style) — use it on 3-5 segments (stats, fire, chart-adjacent, pivot moments): dashboard | fire | budget | signals. Use "none" only where the animated scene tells it better.
- brollQuery: for atmosphere scenes (title, macro, news, dividends, outro) give a cinematic 2-3 word stock-footage query matching the mood; "none" for tool-screenshot and data scenes.
- For the news segment's bullets use "TICKER: headline essence" so ticker chips render.

HARD GROUNDING RULES (non-negotiable):
- EVERY number said or displayed must appear in the provided data JSON (rounding for speech is fine: 15263.11 -> "about 15,300 euros"). Never invent, extrapolate or estimate figures not in the data.
- Null/missing fields: don't mention them.
- Macro and news: ONLY the provided index moves and headlines; characterize and connect, never predict prices.

The description must also contain the disclaimer. Total voiceover length: aim for the requested target minutes at ~150 spoken words per minute.`;

async function main() {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing in .env.local");
  const cfg = loadConfig();
  const week = isoWeekId();
  const dir = episodeDir(week);
  const data = readJson<EpisodeData>(path.join(dir, "data.json"));
  if (!data) throw new Error("data.json missing — run the snapshot stage first");

  const model = "claude-opus-4-8";
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Channel: ${cfg.channelName}. Language: ${cfg.language}. Target length: ${cfg.targetMinutes} minutes (~${cfg.targetMinutes * 150} words of voiceover total). Week: ${data.week}.${cfg.storyline ? `\n\nThis week's vibe/storyline requested by the creator (weave it through the episode): ${cfg.storyline}` : ""}\n\nEpisode data (the only source of truth for numbers):\n${JSON.stringify(data)}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to write this script");

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as Omit<EpisodeScript, "generatedAt" | "model">;
  // "none" screenshot -> undefined so scenes fall back to the animated default
  for (const seg of parsed.segments) {
    if ((seg.onScreen.screenshot as string) === "none") seg.onScreen.screenshot = null;
  }
  const script: EpisodeScript = { ...parsed, generatedAt: new Date().toISOString(), model };

  writeJson(path.join(dir, "script.json"), script);
  const words = script.segments.reduce((a, s) => a + s.voiceover.split(/\s+/).length, 0);
  console.log(`[script] "${script.title}" — ${script.segments.length} segments, ~${words} words (~${Math.round(words / 150)} min) -> script.json`);
}

main().catch((err) => {
  console.error("[script] FAILED:", err.message ?? err);
  process.exit(1);
});
