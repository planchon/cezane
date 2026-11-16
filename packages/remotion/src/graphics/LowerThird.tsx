import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { LowerThirdProps, WithDuration } from "../catalog";
import { fonts } from "../fonts";
import { palette } from "../theme";
import { clamp, unit } from "../ui/anim";

export const LowerThird: React.FC<WithDuration<LowerThirdProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = unit(width, height);
  const bar = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 });
  const panel = spring({ frame: frame - 5, fps, config: { damping: 22, stiffness: 140 } });
  const out = interpolate(frame, [p.duration - 10, p.duration], [0, 1], clamp);
  const right = p.side === "right";
  const reveal = Math.max(0, panel - out) * 100;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", top: `${p.y * 100}%`, [right ? "right" : "left"]: 60 * k, display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "stretch", gap: 0, transform: "translateY(-50%)" }}>
        <div style={{ width: 14 * k, background: p.accent, borderRadius: 4 * k, transform: `scaleY(${Math.max(0, bar - out)})` }} />
        <div
          style={{
            background: palette.cream,
            padding: `${22 * k}px ${34 * k}px`,
            borderRadius: right ? `${16 * k}px 0 0 ${16 * k}px` : `0 ${16 * k}px ${16 * k}px 0`,
            boxShadow: "0 20px 50px rgba(20,18,15,0.3)",
            clipPath: right ? `inset(0 0 0 ${100 - reveal}%)` : `inset(0 ${100 - reveal}% 0 0)`,
          }}
        >
          <div style={{ fontFamily: fonts.serif, fontWeight: 700, fontSize: 62 * k, color: palette.ink, lineHeight: 1.05, whiteSpace: "nowrap" }}>{p.name}</div>
          {p.title && (
            <div style={{ fontFamily: fonts.ui, fontWeight: 600, fontSize: 28 * k, letterSpacing: "0.14em", textTransform: "uppercase", color: p.accent, marginTop: 8 * k, whiteSpace: "nowrap" }}>{p.title}</div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
