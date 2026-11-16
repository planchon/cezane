import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { ProgressBarProps, WithDuration } from "../catalog";
import { clamp, unit } from "../ui/anim";

export const ProgressBar: React.FC<WithDuration<ProgressBarProps>> = (p) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const k = unit(width, height);
  const t = interpolate(frame, [0, p.duration - 1], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, [p.position]: 0, height: p.height * k, background: "rgba(255,255,255,0.22)" }}>
        <div style={{ height: "100%", width: `${t * 100}%`, background: p.color, borderRadius: `0 ${p.height * k}px ${p.height * k}px 0` }} />
      </div>
    </AbsoluteFill>
  );
};
