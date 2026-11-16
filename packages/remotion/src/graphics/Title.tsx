import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TitleProps, WithDuration } from "../catalog";
import { fonts } from "../fonts";
import { palette } from "../theme";
import { clamp, enterExit, outline, unit, verticalCenter } from "../ui/anim";

export const Title: React.FC<WithDuration<TitleProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = unit(width, height);
  const size = p.size * k;
  const { exit } = enterExit(frame, fps, p.duration, { exitFrames: 9 });
  const elegant = p.style === "elegant";
  const boxed = p.style === "boxed";
  const cy = verticalCenter(p.position);
  const lines = p.text.split("\n").map((l) => l.split(" ").filter(Boolean));
  let wi = 0;
  const kickerIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const subIn = spring({ frame: frame - 10, fps, config: { damping: 200 }, durationInFrames: 16 });
  const scrim =
    p.position === "top"
      ? "linear-gradient(180deg, rgba(20,18,15,0.6) 0%, rgba(20,18,15,0) 48%)"
      : p.position === "bottom"
        ? "linear-gradient(0deg, rgba(20,18,15,0.65) 0%, rgba(20,18,15,0) 50%)"
        : "radial-gradient(ellipse 85% 35% at 50% 50%, rgba(20,18,15,0.55) 0%, rgba(20,18,15,0) 100%)";

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {p.scrim && !boxed && <AbsoluteFill style={{ background: scrim, opacity: kickerIn }} />}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${cy * 100}%`,
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22 * k,
          padding: `0 ${70 * k}px`,
          textAlign: "center",
        }}
      >
        {p.kicker && (
          <div style={{ display: "flex", alignItems: "center", gap: 18 * k, opacity: kickerIn, transform: `translateY(${(1 - kickerIn) * 20 * k}px)` }}>
            <div style={{ width: 56 * k * kickerIn, height: 5 * k, background: p.accent, borderRadius: 3 }} />
            <span style={{ fontFamily: fonts.ui, fontWeight: 700, fontSize: size * 0.26, letterSpacing: "0.22em", textTransform: "uppercase", color: p.accent, textShadow: "0 2px 12px rgba(0,0,0,0.35)" }}>
              {p.kicker}
            </span>
            <div style={{ width: 56 * k * kickerIn, height: 5 * k, background: p.accent, borderRadius: 3 }} />
          </div>
        )}
        {lines.map((words, li) => (
          <div
            key={li}
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              columnGap: size * 0.26,
              ...(boxed ? { background: palette.cream, padding: `${size * 0.08}px ${size * 0.28}px`, borderRadius: 18 * k, boxShadow: "0 18px 50px rgba(0,0,0,0.25)" } : {}),
            }}
          >
            {words.map((w) => {
              const i = wi++;
              const s = spring({ frame: frame - 2 - i * 3, fps, config: { damping: 13, stiffness: 170, mass: 0.6 } });
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    fontFamily: elegant ? fonts.serif : fonts.display,
                    fontWeight: elegant ? 700 : 900,
                    fontSize: size,
                    lineHeight: 1.02,
                    letterSpacing: elegant ? "-0.02em" : "-0.01em",
                    textTransform: p.style === "bold" ? "uppercase" : "none",
                    color: boxed ? palette.ink : p.color,
                    textShadow: boxed ? "none" : elegant ? "0 6px 28px rgba(0,0,0,0.45)" : `${outline(size * 0.035, "rgba(20,18,15,0.9)")}, 0 ${size * 0.08}px ${size * 0.25}px rgba(0,0,0,0.4)`,
                    opacity: interpolate(s, [0, 0.4], [0, 1], clamp),
                    transform: `translateY(${(1 - s) * size * 0.55}px) rotate(${(1 - s) * -4}deg)`,
                  }}
                >
                  {w}
                </span>
              );
            })}
          </div>
        ))}
        {p.subtitle && (
          <div style={{ fontFamily: fonts.ui, fontWeight: 500, fontSize: size * 0.3, color: boxed ? palette.cream : p.color, opacity: subIn, transform: `translateY(${(1 - subIn) * 16 * k}px)`, textShadow: "0 2px 16px rgba(0,0,0,0.5)", maxWidth: width * 0.84 }}>
            {p.subtitle}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
