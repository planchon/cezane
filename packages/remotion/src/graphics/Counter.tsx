import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CounterProps, WithDuration } from "../catalog";
import { fonts } from "../fonts";
import { clamp, enterExit, outline, unit, verticalCenter } from "../ui/anim";

export const Counter: React.FC<WithDuration<CounterProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = unit(width, height);
  const { enter, exit } = enterExit(frame, fps, p.duration);
  const t = interpolate(frame, [4, Math.max(5, p.duration * 0.65)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const value = p.from + (p.to - p.from) * t;
  const text = value.toLocaleString("fr-FR", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals });
  const done = spring({ frame: frame - Math.max(5, p.duration * 0.65), fps, config: { damping: 8, stiffness: 220 } });
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: `${verticalCenter(p.position) * 100}%`, transform: `translateY(-50%) scale(${enter * (1 + 0.06 * Math.sin(done * Math.PI))})`, textAlign: "center" }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 900, fontSize: 230 * k, lineHeight: 1, color: p.color, fontVariantNumeric: "tabular-nums", textShadow: `${outline(8 * k, "#16140F")}, 0 ${18 * k}px ${40 * k}px rgba(0,0,0,0.35)` }}>
          <span style={{ color: p.accent }}>{p.prefix}</span>
          {text}
          <span style={{ color: p.accent }}>{p.suffix}</span>
        </div>
        {p.label && (
          <div style={{ marginTop: 18 * k, fontFamily: fonts.ui, fontWeight: 700, fontSize: 46 * k, letterSpacing: "0.12em", textTransform: "uppercase", color: p.color, textShadow: "0 3px 14px rgba(0,0,0,0.55)" }}>{p.label}</div>
        )}
      </div>
    </AbsoluteFill>
  );
};
