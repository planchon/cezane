import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { EmojiProps, WithDuration } from "../catalog";
import { clamp, unit } from "../ui/anim";

export const Emoji: React.FC<WithDuration<EmojiProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = unit(width, height);
  const s = spring({ frame, fps, config: { damping: 7, stiffness: 180, mass: 0.6 } });
  const out = interpolate(frame, [p.duration - 6, p.duration], [1, 0], clamp);
  const wiggle = p.wiggle ? Math.sin(frame / 2.6) * 12 * Math.exp(-frame / 40) : 0;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: p.x * width, top: p.y * height, fontSize: p.size * k, lineHeight: 1, transform: `translate(-50%, -50%) scale(${s * out}) rotate(${wiggle}deg)`, filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.3))" }}>{p.emoji}</div>
    </AbsoluteFill>
  );
};
