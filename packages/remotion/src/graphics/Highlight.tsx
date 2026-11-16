import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { HighlightProps, WithDuration } from "../catalog";
import { clamp, unit } from "../ui/anim";

export const Highlight: React.FC<WithDuration<HighlightProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = unit(width, height);
  const t = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const out = interpolate(frame, [p.duration - 8, p.duration], [1, 0], clamp);
  const r = p.region;
  const x = interpolate(t, [0, 1], [0, r.x * width]);
  const y = interpolate(t, [0, 1], [0, r.y * height]);
  const w = interpolate(t, [0, 1], [width, r.w * width]);
  const h = interpolate(t, [0, 1], [height, r.h * height]);
  const pulse = p.pulse ? 1 + Math.sin(frame / 9) * 0.006 : 1;
  return (
    <AbsoluteFill style={{ opacity: out, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: p.radius * k, boxShadow: `0 0 0 ${Math.max(width, height) * 2}px rgba(12,12,11,${p.dim * t})` }} />
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: p.radius * k, border: `${4 * k}px solid ${p.color}`, opacity: t, transform: `scale(${pulse})`, boxShadow: `0 0 ${24 * k}px rgba(0,0,0,0.25)` }} />
    </AbsoluteFill>
  );
};
