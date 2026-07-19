import React from "react";
import { Composition, Still } from "remotion";
import { Episode, SCENE_GAP_SECONDS, type EpisodeProps } from "./Episode";
import { Thumbnail, type ThumbnailProps } from "./Thumbnail";

// Sizing comes from input props at render time; these are Studio defaults.
const FPS = 30;

export const Root: React.FC = () => {
  return (
    <>
    <Composition
      id="episode"
      component={Episode as React.FC<Record<string, unknown> & EpisodeProps>}
      width={1280}
      height={720}
      fps={FPS}
      durationInFrames={FPS * 60}
      defaultProps={{ data: null as never, script: null as never, manifest: null as never, channel: "" }}
      calculateMetadata={({ props }) => {
        const manifest = (props as unknown as EpisodeProps).manifest;
        const total = manifest?.segments?.reduce((a, s) => a + s.duration + SCENE_GAP_SECONDS, 0) ?? 60;
        return { durationInFrames: Math.max(FPS, Math.ceil(total * FPS)) };
      }}
    />
      <Still
        id="thumbnail"
        component={Thumbnail as React.FC<Record<string, unknown> & ThumbnailProps>}
        width={1280}
        height={720}
        defaultProps={{ data: null as never, script: null as never, channel: "" }}
      />
    </>
  );
};
