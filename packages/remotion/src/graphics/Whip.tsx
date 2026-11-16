import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { WhipProps, WithDuration } from "../catalog";
import { clamp } from "../ui/anim";

/** A blurred band sweeping across the frame (backdrop blur of whatever is below). */
export const Whip: React.FC<WithDuration<WhipProps>> = (p) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const horizontal = p.direction === "left" || p.direction === "right";
  const size = horizontal ? width : height;
  const sign = p.direction === "left" || p.direction === "up" ? -1 : 1;
  const t = interpolate(frame, [0, p.duration], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const pos = sign * interpolate(t, [0, 1], [-size * 1.6, size * 1.6]);
  const blur = interpolate(Math.abs(t - 0.5), [0, 0.5], [46, 8], clamp);
  const band = horizontal ? { width: size * 1.4, height: "100%", left: (width - size * 1.4) / 2, top: 0 } : { height: size * 1.4, width: "100%", top: (height - size * 1.4) / 2, left: 0 };
  const grad = `linear-gradient(${horizontal ? 90 : 180}deg, rgba(255,255,255,0) 0%, ${p.tint} 50%, rgba(255,255,255,0) 100%)`;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div style={{ position: "absolute", ...band, transform: horizontal ? `translateX(${pos}px)` : `translateY(${pos}px)`, backdropFilter: `blur(${blur}px)`, background: grad, maskImage: `linear-gradient(${horizontal ? 90 : 180}deg, transparent 0%, black 25%, black 75%, transparent 100%)` }} />
    </AbsoluteFill>
  );
};
