import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveBackground } from "../theme";
import { unit } from "./anim";

const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 .7 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

/** Film grain over anything (static, so segments stay identical when rendered alone). */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.35 }) => {
  const { width, height } = useVideoConfig();
  return <AbsoluteFill style={{ backgroundImage: GRAIN, backgroundSize: 260 * unit(width, height) * 1.4, mixBlendMode: "overlay", opacity, pointerEvents: "none" }} />;
};

/**
 * Background of the studio scenes: a painted plate (blurred, with grain and a slow drift)
 * or a flat / soft CSS background.
 */
export const Backdrop: React.FC<{ background: string; blur?: number; drift?: boolean }> = ({ background, blur = 18, drift = true }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const k = unit(width, height);
  const bg = resolveBackground(background);
  const scale = drift ? interpolate(frame, [0, Math.max(1, durationInFrames)], [1.08, 1.02]) : 1.04;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#EDEBE6" }}>
      {"plate" in bg ? (
        <Img
          src={staticFile(`plates/${bg.plate}.jpg`)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, filter: `blur(${blur * k}px) saturate(0.95) brightness(1.03)` }}
        />
      ) : (
        <AbsoluteFill style={{ background: bg.css }} />
      )}
      <Grain opacity={"plate" in bg ? 0.4 : 0.22} />
    </AbsoluteFill>
  );
};
