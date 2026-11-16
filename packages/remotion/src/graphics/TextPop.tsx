import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { TextPopProps, WithDuration } from "../catalog";
import { serif, tracking } from "../fonts";
import { colors } from "../theme";
import { blurIn, blurOut, fadeOut, ramp, softShadow, unit, verticalCenter } from "../ui/anim";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** A short line, words entering one by one; highlighted words get a highlighter stroke. */
export const TextPop: React.FC<WithDuration<TextPopProps>> = (p) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const k = unit(width, height);
  const size = p.size * k;
  const out = fadeOut(frame, p.duration, 7);
  const hl = new Set((p.highlight ?? "").split(/\s+/).map(norm).filter(Boolean));
  const words = p.text.split(/\s+/).filter(Boolean);
  const cy = p.y ?? verticalCenter(p.position);
  return (
    <AbsoluteFill style={blurOut(out, size)}>
      <div
        style={{
          position: "absolute",
          left: 70 * k,
          right: 70 * k,
          top: `${cy * 100}%`,
          transform: "translateY(-50%)",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: size * 0.24,
          rowGap: size * 0.04,
          ...serif(600),
          fontSize: size,
          lineHeight: 1.08,
          letterSpacing: tracking.display,
          color: p.color,
          textShadow: softShadow(size),
        }}
      >
        {words.map((w, i) => {
          const t = ramp(frame, i * 3, 12);
          const isHl = hl.has(norm(w));
          const mark = ramp(frame, i * 3 + 8, 10);
          return (
            <span key={i} style={{ ...blurIn(t, size), position: "relative" }}>
              {isHl && (
                <span
                  style={{
                    position: "absolute",
                    left: -0.06 * size,
                    right: -0.06 * size,
                    top: 0.14 * size,
                    bottom: 0.04 * size,
                    background: p.accent,
                    borderRadius: 0.08 * size,
                    transform: `scaleX(${mark})`,
                    transformOrigin: "0 50%",
                    zIndex: -1,
                  }}
                />
              )}
              <span style={{ position: "relative", color: isHl && p.accent !== colors.marker ? p.color : undefined }}>{w}</span>
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
