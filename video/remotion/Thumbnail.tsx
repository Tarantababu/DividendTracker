// YouTube thumbnail (single still, 1280x720): total portfolio value + weekly P/L,
// big and readable at feed size, over the episode's dashboard screenshot when captured.
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { T, fmtEur } from "./theme";
import type { EpisodeData } from "../pipeline/snapshot";
import type { EpisodeScript } from "../pipeline/script";

export interface ThumbnailProps {
  data: EpisodeData;
  script: EpisodeScript;
  channel: string;
  shots?: Record<string, string>;
}

export const Thumbnail: React.FC<ThumbnailProps> = ({ data, script, channel, shots }) => {
  const change = data.portfolio.weekChange ?? 0;
  const up = change >= 0;
  const pct = data.portfolio.weekChangePct;
  const bg = shots?.dashboard;
  return (
    <AbsoluteFill style={{ background: T.bg, fontFamily: T.font, color: T.text }}>
      {bg && (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <Img src={staticFile(bg)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", transform: "scale(1.08) rotate(-2deg)", filter: "brightness(0.35) blur(1px)" }} />
        </AbsoluteFill>
      )}
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px circle at 85% 15%, ${T.primary}40, transparent 65%), radial-gradient(700px circle at 10% 90%, ${up ? T.accent : T.red}30, transparent 60%), linear-gradient(180deg, ${T.bg}55, ${T.bg}cc)`,
        }}
      />
      <AbsoluteFill style={{ padding: 70, justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", color: T.primary, textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>{channel}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: T.muted, background: `${T.card}dd`, borderRadius: 14, padding: "10px 24px" }}>{data.week}</div>
        </div>

        <div>
          <div style={{ fontSize: 44, fontWeight: 700, color: T.muted, textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}>MY PORTFOLIO</div>
          <div style={{ fontSize: 150, fontWeight: 900, letterSpacing: -4, lineHeight: 1.05, textShadow: "0 6px 30px rgba(0,0,0,0.85)" }}>
            {fmtEur(data.portfolio.totalValue)}
          </div>
          <div
            style={{
              display: "inline-block",
              marginTop: 26,
              fontSize: 58,
              fontWeight: 900,
              color: "#fff",
              background: up ? T.accent : T.red,
              borderRadius: 22,
              padding: "16px 42px",
              boxShadow: `0 10px 40px ${up ? T.accent : T.red}66`,
              transform: "rotate(-1.5deg)",
            }}
          >
            {up ? "+" : ""}
            {fmtEur(change)} THIS WEEK{pct != null ? ` (${(pct * 100).toFixed(1)}%)` : ""}
          </div>
        </div>

        <div style={{ fontSize: 40, fontWeight: 800, color: T.text, textShadow: "0 2px 14px rgba(0,0,0,0.9)" }}>{script.thumbnailText}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
