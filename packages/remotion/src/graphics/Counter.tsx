import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CounterProps, WithDuration } from "../catalog";
import { fonts, tracking } from "../fonts";
import { colors } from "../theme";
import { blurIn, blurOut, clamp, fadeOut, ramp, softShadow, unit, verticalCenter } from "../ui/anim";

/** A number counting up, tabular figures, with a muted label under it. */
export const Counter: React.FC<WithDuration<CounterProps>> = (p) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const k = unit(width, height);
  const size = 250 * k;
  const out = fadeOut(frame, p.duration);
  const t = interpolate(frame, [4, Math.max(5, p.duration * 0.6)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const value = p.from + (p.to - p.from) * t;
  const text = value.toLocaleString("fr-FR", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals });
  const light = p.color.toUpperCase() === colors.white || p.color.toLowerCase() === "#fff";
  const shadow = light ? softShadow(size * 0.6) : "none";
  return (
    <AbsoluteFill style={blurOut(out, size)}>
      <div style={{ position: "absolute", left: 0, right: 0, top: `${verticalCenter(p.position) * 100}%`, transform: "translateY(-50%)", textAlign: "center" }}>
        <div style={{ ...blurIn(ramp(frame, 0, 14), size), display: "block", fontFamily: fonts.sans, fontWeight: 600, fontSize: size, lineHeight: 1, letterSpacing: tracking.sans, color: p.color, fontVariantNumeric: "tabular-nums", textShadow: shadow }}>
          {p.prefix && <span style={{ color: p.accent, opacity: p.accent === p.color ? 0.6 : 1 }}>{p.prefix}</span>}
          {text}
          {p.suffix && <span style={{ color: p.accent, opacity: p.accent === p.color ? 0.6 : 1 }}>{p.suffix}</span>}
        </div>
        {p.label && (
          <div style={{ ...blurIn(ramp(frame, 6, 14), 46 * k), display: "block", marginTop: 16 * k, opacity: 0.75 * ramp(frame, 6, 14), fontFamily: fonts.sans, fontWeight: 500, fontSize: 54 * k, letterSpacing: tracking.text, color: p.color, textShadow: shadow }}>{p.label}</div>
        )}
      </div>
    </AbsoluteFill>
  );
};
