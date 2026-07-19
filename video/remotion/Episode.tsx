// The full episode: a Series of scenes, each exactly as long as its voiceover
// audio (+ a short gap), with a fade between scenes.
import React from "react";
import { AbsoluteFill, Audio, Series, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene } from "./scenes";
import type { EpisodeData } from "../pipeline/snapshot";
import type { EpisodeScript, Segment } from "../pipeline/script";
import type { AudioManifest } from "../pipeline/voice";

export const SCENE_GAP_SECONDS = 0.5; // must match pipeline/subtitles.ts

export interface EpisodeProps {
  data: EpisodeData;
  script: EpisodeScript;
  manifest: AudioManifest;
  channel: string;
  shots?: Record<string, string>; // screenshot key -> episode-relative png
  broll?: Record<string, string>; // segment id -> episode-relative stock clip
  music?: string; // episode-relative music bed, mixed low under the voice
  musicVolume?: number;
}

/** Scene entrance/exit: spring scale+rise in, fade out at the end, accent sweep on entry. */
const SceneIn: React.FC<{ children: React.ReactNode; durationInFrames: number }> = ({ children, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 22, mass: 0.8 } });
  const exit = interpolate(frame, [durationInFrames - Math.round(fps * 0.35), durationInFrames - 2], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sweep = interpolate(frame, [0, Math.round(fps * 0.5)], [-width, width * 1.2], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: Math.min(enter, exit), transform: `scale(${0.95 + enter * 0.05}) translateY(${(1 - enter) * 26}px)` }}>
      {children}
      {frame < fps * 0.6 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: sweep,
            width: width * 0.5,
            height: 5,
            background: "linear-gradient(90deg, transparent, #6366f1, #22c55e, transparent)",
            opacity: 0.9,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

/** Thin episode-progress bar along the bottom edge. */
const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${(frame / durationInFrames) * 100}%`, background: "linear-gradient(90deg, #6366f1, #22c55e)", zIndex: 10 }} />
  );
};

export const Episode: React.FC<EpisodeProps> = ({ data, script, manifest, channel, shots, broll, music, musicVolume }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#0c0e16" }}>
      {music && <Audio src={staticFile(music)} loop volume={musicVolume ?? 0.07} />}
      <Series>
        {script.segments.map((segment: Segment) => {
          const audio = manifest.segments.find((a) => a.id === segment.id);
          if (!audio) return null;
          const frames = Math.ceil((audio.duration + SCENE_GAP_SECONDS) * fps);
          return (
            <Series.Sequence key={segment.id} durationInFrames={frames}>
              <SceneIn durationInFrames={frames}>
                <Scene segment={segment} data={data} channel={channel} shots={shots} broll={broll?.[segment.id]} />
              </SceneIn>
              <Audio src={staticFile(audio.file)} />
            </Series.Sequence>
          );
        })}
      </Series>
      <ProgressBar />
    </AbsoluteFill>
  );
};
