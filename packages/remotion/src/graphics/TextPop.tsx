import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TextPopProps, WithDuration } from "../catalog";
import { fonts } from "../fonts";
import { clamp, enterExit, outline, unit, verticalCenter } from "../ui/anim";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export const TextPop: React.FC<WithDuration<TextPopProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = unit(width, height);
  const size = p.size * k;
  const { exit } = enterExit(frame, fps, p.duration, { exitFrames: 6 });
  const hl = new Set((p.highlight ?? "").split(/\s+/).map(norm).filter(Boolean));
  const words = p.text.split(/\s+/).filter(Boolean);
  const cy = p.y ?? verticalCenter(p.position);
  return (
    <AbsoluteFill style={{ opacity: exit, transform: `scale(${interpolate(exit, [0, 1], [0.9, 1])})` }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: `${cy * 100}%`, transform: "translateY(-50%)", display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: size * 0.28, rowGap: size * 0.05, padding: `0 ${60 * k}px` }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - i * 4, fps, config: { damping: 9, stiffness: 210, mass: 0.6 } });
          const isHl = hl.has(norm(w));
          const draw = interpolate(frame - i * 4, [6, 16], [0, 1], clamp);
          return (
            <span key={i} style={{ position: "relative", display: "inline-block", transform: `scale(${s}) rotate(${(1 - s) * -10}deg)`, opacity: interpolate(s, [0, 0.3], [0, 1], clamp) }}>
              <span style={{ fontFamily: fonts.display, fontWeight: 900, fontSize: size, lineHeight: 1.05, textTransform: "uppercase", color: isHl ? p.accent : p.color, textShadow: `${outline(size * 0.045, "#16140F")}, 0 ${size * 0.09}px 0 rgba(0,0,0,0.25)` }}>{w}</span>
              {isHl && (
                <svg viewBox="0 0 100 12" preserveAspectRatio="none" style={{ position: "absolute", left: "-4%", width: "108%", bottom: -size * 0.12, height: size * 0.2, overflow: "visible" }}>
                  <path d="M2 8 C 25 3, 55 2, 98 6" fill="none" stroke={p.accent} strokeWidth={7} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
                </svg>
              )}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
