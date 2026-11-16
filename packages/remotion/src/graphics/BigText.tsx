import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { BigTextProps, WithDuration } from "../catalog";
import { serif } from "../fonts";
import { blurIn, blurOut, fadeOut, ramp, unit } from "../ui/anim";
import { behindLayout } from "../ui/placement";

/** Average advance of Newsreader semibold at -0.035em, in em: enough to fit a word to the width. */
const ADVANCE = 0.5;

/** Giant word(s) across the frame; behind the person when the clip says so. */
export const BigText: React.FC<WithDuration<BigTextProps>> = (p) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const k = unit(W, H);
  const lines = p.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const wanted = p.size ? p.size * k : Math.min(460 * k, (W * 0.92) / (longest * ADVANCE));
  const layout = behindLayout(p.subject, (lines.length * wanted * 0.88) / H, p.position);
  // Behind a person the block must fit between the top tabs and the top of the head.
  const size = Math.min(wanted, (layout.maxH * H) / (lines.length * 0.88));
  const cy = p.y ?? layout.y;
  const out = fadeOut(frame, p.duration, 8);
  let wi = 0;
  return (
    <AbsoluteFill style={blurOut(out, size * 0.3)}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${cy * 100}%`,
          transform: "translateY(-50%)",
          textAlign: "center",
          ...serif(p.weight),
          fontSize: size,
          lineHeight: 0.88,
          letterSpacing: "-0.035em",
          color: p.color,
          textShadow: `0 ${size * 0.02}px ${size * 0.12}px rgba(0,0,0,0.18)`,
        }}
      >
        {lines.map((l, li) => (
          <div key={li} style={{ display: "flex", justifyContent: "center", columnGap: "0.18em", whiteSpace: "nowrap" }}>
            {l.split(" ").map((w) => {
              const t = ramp(frame, 2 + wi++ * 3, 14);
              return (
                <span key={wi} style={{ ...blurIn(t, size * 0.3), transform: `${blurIn(t, size * 0.3).transform ?? ""} scale(${1.04 - 0.04 * t})` }}>
                  {w}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
