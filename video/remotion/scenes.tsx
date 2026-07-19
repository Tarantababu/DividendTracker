// All episode scenes. Each receives its script segment + the episode data and
// animates in over the segment's audio. Kept dependency-free: charts are hand-drawn SVG.
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { T, fmtEur, fmtPct } from "./theme";
import type { EpisodeData } from "../pipeline/snapshot";
import type { Segment } from "../pipeline/script";

interface SceneProps {
  segment: Segment;
  data: EpisodeData;
  shots?: Record<string, string>; // screenshot key -> episode-relative file
  broll?: string; // episode-relative stock clip for this segment's backdrop
}

/* ---------- shared bits ---------- */

/** Per-segment stock-footage backdrop, provided by the Scene router. */
const BrollContext = React.createContext<string | undefined>(undefined);

/** Ambient backdrop: stock B-roll (dimmed, slow-zoomed) when available, else
 *  drifting color glows — plus the faint grid either way. */
const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const broll = React.useContext(BrollContext);
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const gx = width * 0.75 + Math.sin(frame / 90) * 60;
  const gy = height * 0.2 + Math.cos(frame / 110) * 40;
  const gx2 = width * 0.15 + Math.cos(frame / 100) * 50;
  const gy2 = height * 0.85 + Math.sin(frame / 80) * 40;
  const zoom = interpolate(frame, [0, durationInFrames], [1.02, 1.1]);
  return (
    <AbsoluteFill style={{ background: T.bg, fontFamily: T.font, color: T.text }}>
      {broll && (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <OffthreadVideo
            src={staticFile(broll)}
            muted
            loop
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`, filter: "brightness(0.32) saturate(0.85)" }}
          />
          <AbsoluteFill style={{ background: `linear-gradient(180deg, ${T.bg}99 0%, transparent 40%, ${T.bg}cc 100%)` }} />
        </AbsoluteFill>
      )}
      {!broll && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(560px circle at ${gx}px ${gy}px, ${T.primary}26, transparent 70%), radial-gradient(480px circle at ${gx2}px ${gy2}px, ${T.accent}17, transparent 70%)`,
          }}
        />
      )}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${T.cardBorder}55 1px, transparent 1px), linear-gradient(90deg, ${T.cardBorder}55 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          opacity: broll ? 0.12 : 0.25,
        }}
      />
      <AbsoluteFill style={{ padding: 64 }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Animate the first number in a "label: value" bullet counting up (€, % or plain).
 *  Numbers are en-formatted ("15,356.01"): commas = thousands, dot = decimal. */
const CountUp: React.FC<{ text: string; progress: number }> = ({ text, progress }) => {
  const m = text.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m || progress >= 0.99) return <>{text}</>;
  const numeric = parseFloat(m[0].replace(/,/g, ""));
  if (!isFinite(numeric)) return <>{text}</>;
  const decimals = m[0].includes(".") ? m[0].split(".")[1].length : 0;
  const formatted = new Intl.NumberFormat("en-IE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(numeric * progress);
  return (
    <>
      {text.slice(0, m.index)}
      {formatted}
      {text.slice((m.index ?? 0) + m[0].length)}
    </>
  );
};

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  const grow = spring({ frame: frame - Math.round(fps * 0.25), fps, config: { damping: 30 } });
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -0.5, opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>{children}</div>
      <div style={{ marginTop: 10, height: 5, width: `${grow * 160}px`, borderRadius: 3, background: `linear-gradient(90deg, ${T.primary}, ${T.accent})` }} />
    </div>
  );
};

const Bullets: React.FC<{ items: string[]; startFrame?: number }> = ({ items, startFrame = 12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {items.map((b, i) => {
        const s = spring({ frame: frame - startFrame - i * Math.round(fps * 0.35), fps, config: { damping: 200 } });
        const [label, value] = b.includes(":") ? [b.slice(0, b.indexOf(":")), b.slice(b.indexOf(":") + 1)] : [b, ""];
        return (
          <div
            key={i}
            style={{
              background: T.card,
              border: `1px solid ${T.cardBorder}`,
              borderRadius: 16,
              padding: "20px 28px",
              fontSize: 30,
              display: "flex",
              justifyContent: "space-between",
              gap: 24,
              opacity: s,
              transform: `translateX(${(1 - s) * -40}px) scale(${0.96 + s * 0.04})`,
              boxShadow: `0 ${(1 - s) * 12 + 4}px 24px rgba(0,0,0,${0.35 * s})`,
            }}
          >
            <span style={{ color: T.muted }}>{label.trim()}</span>
            {value && (
              <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                <CountUp text={value.trim()} progress={s} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

const Watermark: React.FC<{ week: string }> = ({ week }) => (
  <div style={{ position: "absolute", bottom: 28, right: 40, color: T.muted2, fontSize: 20 }}>{week}</div>
);

/* ---------- scenes ---------- */

export const TitleScene: React.FC<SceneProps & { channel: string }> = ({ segment, data, channel }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s1 = spring({ frame, fps, config: { damping: 200 } });
  const words = segment.onScreen.heading.split(/\s+/);
  const wordsDone = Math.round(fps * (0.25 + words.length * 0.09));
  const s2 = spring({ frame: frame - wordsDone, fps, config: { damping: 12, mass: 0.7 } });
  const pulse = 1 + Math.sin(frame / 9) * 0.012;
  return (
    <Frame>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", padding: 80 }}>
        <div style={{ fontSize: 28, color: T.primary, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", opacity: s1 }}>{channel}</div>
        <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -1.5, marginTop: 24, lineHeight: 1.15 }}>
          {/* word-by-word pop */}
          {words.map((w, i) => {
            const ws = spring({ frame: frame - Math.round(fps * (0.15 + i * 0.09)), fps, config: { damping: 16, mass: 0.6 } });
            return (
              <span key={i} style={{ display: "inline-block", marginRight: 16, opacity: ws, transform: `translateY(${(1 - ws) * 34}px) scale(${0.9 + ws * 0.1})` }}>
                {w}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 40, transform: `scale(${s2 * pulse})` }}>
          {segment.onScreen.bullets[0] && (
            <div
              style={{
                fontSize: 44,
                fontWeight: 700,
                color: T.accent,
                background: T.card,
                border: `1px solid ${T.cardBorder}`,
                borderRadius: 20,
                padding: "18px 44px",
                boxShadow: `0 0 ${24 + Math.sin(frame / 9) * 10}px ${T.accent}44`,
              }}
            >
              <CountUp text={segment.onScreen.bullets[0]} progress={s2} />
            </div>
          )}
        </div>
      </AbsoluteFill>
      <Watermark week={data.week} />
    </Frame>
  );
};

export const StatsScene: React.FC<SceneProps> = ({ segment, data }) => (
  <Frame>
    <Heading>{segment.onScreen.heading}</Heading>
    <Bullets items={segment.onScreen.bullets} />
    <Watermark week={data.week} />
  </Frame>
);

/** Value vs invested line chart, drawn left-to-right as the narration plays. */
export const ChartScene: React.FC<SceneProps> = ({ segment, data }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const W = width - 128;
  const H = 420;
  const series = data.valueSeries;
  if (series.length < 2) return <StatsScene segment={segment} data={data} />;

  const values = series.map((p) => p.value);
  const costs = series.map((p) => p.cost);
  const min = Math.min(...values, ...costs) * 0.98;
  const max = Math.max(...values, ...costs) * 1.02;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const valuePts = series.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const costPts = series.map((p, i) => `${x(i)},${y(p.cost)}`).join(" ");
  const areaPts = `0,${H} ${valuePts} ${W},${H}`;

  const reveal = interpolate(frame, [Math.round(fps * 0.4), Math.min(durationInFrames - fps, fps * 4)], [0, W], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const last = series[series.length - 1];

  return (
    <Frame>
      <Heading>{segment.onScreen.heading}</Heading>
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.primary} stopOpacity={0.35} />
            <stop offset="100%" stopColor={T.primary} stopOpacity={0} />
          </linearGradient>
          <clipPath id="reveal">
            <rect x={0} y={-40} width={reveal} height={H + 80} />
          </clipPath>
        </defs>
        <g clipPath="url(#reveal)">
          <polygon points={areaPts} fill="url(#fill)" />
          <polyline points={valuePts} fill="none" stroke={T.primary} strokeWidth={4} style={{ filter: `drop-shadow(0 0 10px ${T.primary}aa)` }} />
          <polyline points={costPts} fill="none" stroke={T.muted2} strokeWidth={3} strokeDasharray="10 8" />
        </g>
        {reveal >= W - 1 && (
          <g>
            <circle cx={W} cy={y(last.value)} r={8} fill={T.primary} style={{ filter: `drop-shadow(0 0 8px ${T.primary})` }} />
            <text x={W - 12} y={y(last.value) - 18} fill={T.text} fontSize={26} fontWeight={700} textAnchor="end">
              {fmtEur(last.value)}
            </text>
            <text x={W - 12} y={y(last.cost) + 34} fill={T.muted} fontSize={22} textAnchor="end">
              invested {fmtEur(last.cost)}
            </text>
          </g>
        )}
      </svg>
      <div style={{ display: "flex", gap: 32, marginTop: 24, fontSize: 24, color: T.muted, alignItems: "center" }}>
        <span>
          <span style={{ color: T.primary }}>━</span> portfolio value
        </span>
        <span>
          <span style={{ color: T.muted2 }}>╌╌</span> money invested
        </span>
        {reveal >= W - 1 && last.cost > 0 && (
          <span
            style={{
              marginLeft: "auto",
              background: last.value >= last.cost ? `${T.accent}22` : `${T.red}22`,
              color: last.value >= last.cost ? T.accent : T.red,
              fontWeight: 800,
              borderRadius: 12,
              padding: "8px 20px",
              fontSize: 28,
            }}
          >
            {last.value >= last.cost ? "+" : ""}
            {fmtEur(last.value - last.cost)} gain
          </span>
        )}
      </div>
      <Watermark week={data.week} />
    </Frame>
  );
};

export const FireScene: React.FC<SceneProps> = ({ segment, data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rows = data.fire.types.filter((t) => ["regular", "dividend", "coast"].includes(t.key));
  return (
    <Frame>
      <Heading>{segment.onScreen.heading}</Heading>
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {rows.map((t, i) => {
          const s = spring({ frame: frame - 10 - i * Math.round(fps * 0.5), fps, config: { damping: 200 } });
          const barPct = Math.min(1, t.progressPct) * s;
          return (
            <div key={t.key} style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 16, padding: "22px 28px", opacity: s }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 27, marginBottom: 14 }}>
                <span style={{ fontWeight: 700 }}>{t.label}</span>
                <span style={{ color: T.muted }}>
                  {fmtEur(t.target)} · {t.etaYears != null ? `${t.etaYears}y to go` : "60y+"}
                </span>
              </div>
              <div style={{ height: 16, background: "#20243a", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${barPct * 100}%`, borderRadius: 8, background: `linear-gradient(90deg, ${T.primary}, ${T.accent})` }} />
              </div>
              <div style={{ fontSize: 21, color: T.accent, marginTop: 8, fontWeight: 600 }}>{(t.progressPct * 100).toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
      <Watermark week={data.week} />
    </Frame>
  );
};

export const LookthroughScene: React.FC<SceneProps> = ({ segment, data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const maxPct = Math.max(...data.lookthrough.map((s) => s.pct), 0.01);
  return (
    <Frame>
      <Heading>{segment.onScreen.heading}</Heading>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {data.lookthrough.map((s, i) => {
          const sp = spring({ frame: frame - 10 - i * Math.round(fps * 0.4), fps, config: { damping: 200 } });
          return (
            <div key={s.symbol} style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 27, opacity: sp }}>
              <span style={{ width: 170, fontWeight: 700 }}>{s.symbol}</span>
              <div style={{ flex: 1, height: 26, background: "#20243a", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(s.pct / maxPct) * 100 * sp}%`, background: T.primary, borderRadius: 8 }} />
              </div>
              <span style={{ width: 110, textAlign: "right", fontWeight: 600 }}>{(s.pct * 100).toFixed(2)}%</span>
              <span style={{ width: 130, color: T.muted, fontSize: 21 }}>{s.funds > 0 ? `${s.funds} ETFs` : "direct"}</span>
            </div>
          );
        })}
      </div>
      <Watermark week={data.week} />
    </Frame>
  );
};

/** Headlines around the actual holdings: ticker chip + headline card, staggered. */
export const NewsScene: React.FC<SceneProps> = ({ segment, data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tickers = data.holdingsNews.map((h) => h.ticker.toUpperCase());
  return (
    <Frame>
      <Heading>{segment.onScreen.heading}</Heading>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {segment.onScreen.bullets.slice(0, 4).map((b, i) => {
          const s = spring({ frame: frame - 12 - i * Math.round(fps * 0.55), fps, config: { damping: 200 } });
          const idx = b.indexOf(":");
          const rawTicker = idx > 0 ? b.slice(0, idx).trim().toUpperCase() : "";
          const isTicker = idx > 0 && (tickers.includes(rawTicker) || /^[A-Z0-9.^=-]{1,10}$/.test(rawTicker));
          const headline = isTicker ? b.slice(idx + 1).trim() : b;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 20,
                background: T.card,
                border: `1px solid ${T.cardBorder}`,
                borderLeft: `5px solid ${T.blue}`,
                borderRadius: 16,
                padding: "22px 28px",
                opacity: s,
                transform: `translateX(${(1 - s) * 60}px)`,
              }}
            >
              {isTicker && (
                <span style={{ background: `${T.blue}2b`, color: T.blue, fontWeight: 800, fontSize: 22, borderRadius: 10, padding: "6px 14px", whiteSpace: "nowrap" }}>
                  {rawTicker}
                </span>
              )}
              <span style={{ fontSize: 27, lineHeight: 1.35 }}>{headline}</span>
            </div>
          );
        })}
      </div>
      <Watermark week={data.week} />
    </Frame>
  );
};

export const MacroScene: React.FC<SceneProps> = ({ segment, data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // The index cards already show the moves — drop bullets that just repeat an index
  const indexNames = data.macro.indices.map((ix) => ix.name.toLowerCase());
  const bullets = segment.onScreen.bullets.filter((b) => !indexNames.some((n) => b.toLowerCase().includes(n))).slice(0, 3);
  return (
    <Frame>
      <Heading>{segment.onScreen.heading}</Heading>
      <div style={{ display: "flex", gap: 20, marginBottom: 34, flexWrap: "wrap" }}>
        {data.macro.indices
          .filter((ix) => ix.weekPct != null)
          .map((ix, i) => {
            const s = spring({ frame: frame - 8 - i * Math.round(fps * 0.25), fps, config: { damping: 200 } });
            const up = (ix.weekPct ?? 0) >= 0;
            return (
              <div key={ix.symbol} style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 16, padding: "18px 26px", opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>
                <div style={{ fontSize: 21, color: T.muted }}>{ix.name}</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: up ? T.accent : T.red, marginTop: 6 }}>{fmtPct(ix.weekPct ?? 0)}</div>
              </div>
            );
          })}
      </div>
      <Bullets items={bullets} startFrame={Math.round(fps * 1.2)} />
      <Watermark week={data.week} />
    </Frame>
  );
};

export const OutroScene: React.FC<SceneProps & { channel: string }> = ({ segment, data, channel }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  return (
    <Frame>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", padding: 90 }}>
        <div style={{ fontSize: 48, fontWeight: 800, opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>{segment.onScreen.heading}</div>
        <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 14 }}>
          {segment.onScreen.bullets.map((b, i) => {
            const sb = spring({ frame: frame - 15 - i * Math.round(fps * 0.4), fps, config: { damping: 200 } });
            return (
              <div key={i} style={{ fontSize: 28, color: T.muted, opacity: sb }}>
                {b}
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", bottom: 60, fontSize: 20, color: T.muted2, maxWidth: 900 }}>
          Not financial advice — personal journey only. · {channel}
        </div>
      </AbsoluteFill>
      <Watermark week={data.week} />
    </Frame>
  );
};

/** Real screenshot of the tool inside a browser window (Joseph Carlson style):
 *  slow vertical pan down the page, window chrome with traffic lights + URL. */
export const ScreenshotScene: React.FC<SceneProps & { shotFile: string }> = ({ segment, data, shotFile }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  // Slow scroll down the page, then hold; gentle zoom the whole way
  const pan = interpolate(frame, [Math.round(fps * 0.8), durationInFrames - Math.round(fps * 0.6)], [0, 70], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.05]);
  const s = spring({ frame: frame - Math.round(fps * 0.4), fps, config: { damping: 200 } });
  const sWin = spring({ frame, fps, config: { damping: 100 } });
  return (
    <AbsoluteFill style={{ background: T.bg, fontFamily: T.font, color: T.text }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(700px circle at 80% 10%, ${T.primary}22, transparent 70%), radial-gradient(560px circle at 15% 95%, ${T.accent}14, transparent 70%)` }}
      />
      {/* Browser window with the live tool inside */}
      <AbsoluteFill style={{ padding: "56px 72px 40px", opacity: sWin, transform: `translateY(${(1 - sWin) * 40}px) scale(${zoom})` }}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%", borderRadius: 18, overflow: "hidden", border: `1px solid ${T.cardBorder}`, boxShadow: "0 30px 80px rgba(0,0,0,0.55)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#1d2135", padding: "12px 18px" }}>
            <span style={{ width: 13, height: 13, borderRadius: 7, background: "#ff5f57" }} />
            <span style={{ width: 13, height: 13, borderRadius: 7, background: "#febc2e" }} />
            <span style={{ width: 13, height: 13, borderRadius: 7, background: "#28c840" }} />
            <span style={{ marginLeft: 16, background: "#12151f", color: T.muted, fontSize: 17, borderRadius: 8, padding: "5px 18px", flex: 1, textAlign: "center" }}>
              localhost:3000 — my dividend tracker
            </span>
          </div>
          <div style={{ flex: 1, overflow: "hidden", background: "#fff" }}>
            <Img src={staticFile(shotFile)} style={{ width: "100%", height: "auto", transform: `translateY(-${pan}%)` }} />
          </div>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${T.bg}b3 0%, transparent 22%, transparent 70%, ${T.bg}d9 100%)`, pointerEvents: "none" }} />
      <AbsoluteFill style={{ padding: 64, justifyContent: "space-between" }}>
        <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -0.5, textShadow: "0 2px 18px rgba(0,0,0,0.7)" }}>{segment.onScreen.heading}</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {segment.onScreen.bullets.slice(0, 3).map((b, i) => {
            const sb = spring({ frame: frame - Math.round(fps * (0.6 + i * 0.35)), fps, config: { damping: 200 } });
            return (
              <span
                key={i}
                style={{
                  background: `${T.card}f0`,
                  border: `1px solid ${T.cardBorder}`,
                  borderRadius: 14,
                  padding: "14px 24px",
                  fontSize: 26,
                  fontWeight: 600,
                  opacity: sb,
                  transform: `translateY(${(1 - sb) * 20}px)`,
                }}
              >
                <CountUp text={b} progress={sb} />
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", top: 28, right: 40, background: `${T.primary}2b`, color: T.primary, borderRadius: 10, padding: "6px 16px", fontSize: 20, fontWeight: 700, opacity: s }}>
        LIVE FROM MY TRACKER
      </div>
      <Watermark week={data.week} />
    </AbsoluteFill>
  );
};

/** Scene router. Screenshot-backed when the script asked for one and the capture exists;
 *  otherwise the animated scene, over stock B-roll when a clip was fetched. */
export const Scene: React.FC<SceneProps & { channel: string }> = (props) => {
  const wanted = props.segment.onScreen.screenshot;
  if (wanted && props.shots?.[wanted]) {
    return <ScreenshotScene {...props} shotFile={props.shots[wanted]} />;
  }
  return (
    <BrollContext.Provider value={props.broll}>
      <SceneInner {...props} />
    </BrollContext.Provider>
  );
};

const SceneInner: React.FC<SceneProps & { channel: string }> = (props) => {
  switch (props.segment.scene) {
    case "title":
      return <TitleScene {...props} />;
    case "news":
      return props.data.holdingsNews.length || props.segment.onScreen.bullets.length ? <NewsScene {...props} /> : <StatsScene {...props} />;
    case "chart":
      return <ChartScene {...props} />;
    case "fire":
      return <FireScene {...props} />;
    case "lookthrough":
      return props.data.lookthrough.length ? <LookthroughScene {...props} /> : <StatsScene {...props} />;
    case "macro":
      return <MacroScene {...props} />;
    case "outro":
      return <OutroScene {...props} />;
    default:
      return <StatsScene {...props} />;
  }
};
