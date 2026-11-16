import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { TitleProps, WithDuration } from "../catalog";
import { fonts, serif, tracking } from "../fonts";
import { colors } from "../theme";
import { blurIn, blurOut, ENTER, fadeOut, ramp, softShadow, STAGGER, unit, verticalCenter } from "../ui/anim";
import { Label } from "../ui/Label";
import { behindY } from "../ui/placement";

/**
 * Title in the Studio look: a tight grotesk, a second line in a muted tone, words entering
 * from a slight blur. `native` draws white blocks like text typed in the TikTok app.
 */
export const Title: React.FC<WithDuration<TitleProps>> = (p) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const k = unit(width, height);
  const size = p.size * k;
  const native = p.style === "native";
  const dark = p.style === "ink";
  const color = p.color ?? (dark ? colors.ink : colors.white);
  const align = p.align ?? (native ? "center" : "left");
  const out = fadeOut(frame, p.duration, 9);
  const main = p.text.split("\n");
  const second = p.muted ? p.muted.split("\n") : [];
  const blockH = ((main.length + second.length) * size * (native ? 0.86 : 1)) / height;
  const cy = p.y ?? (p.subject ? behindY(p.subject, blockH, p.position) : verticalCenter(p.position));
  let wi = 0;
  const word = (w: string, fs: number) => {
    const t = ramp(frame, 3 + wi++ * STAGGER, ENTER);
    return (
      <span key={wi} style={{ ...blurIn(t, fs), marginRight: "0.24em" }}>
        {w}
      </span>
    );
  };
  const line = (l: string, i: number, tone: "main" | "muted") => (
    <div key={`${tone}${i}`} style={{ opacity: tone === "muted" ? (dark ? 0.55 : 0.72) : 1, fontStyle: tone === "muted" ? "italic" : "normal" }}>
      {l.split(" ").filter(Boolean).map((w) => word(w, size))}
    </div>
  );

  const scrim =
    !p.scrim || native || dark || p.subject
      ? null
      : cy < 0.4
        ? "linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 45%)"
        : cy > 0.6
          ? "linear-gradient(0deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 48%)"
          : "radial-gradient(ellipse 90% 30% at 50% 50%, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 100%)";

  return (
    <AbsoluteFill style={{ ...blurOut(out, size) }}>
      {scrim && <AbsoluteFill style={{ background: scrim, opacity: ramp(frame, 0, 10) }} />}
      <div
        style={{
          position: "absolute",
          left: 84 * k,
          right: 84 * k,
          top: `${cy * 100}%`,
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: align === "center" ? "center" : "flex-start",
          textAlign: align,
          gap: 28 * k,
        }}
      >
        {p.kicker && <Label text={p.kicker} k={k} t={ramp(frame, 0, ENTER)} dark={!dark && !native} />}
        {native ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {[...main, ...second].map((l, i) => (
              <div
                key={i}
                style={{
                  ...blurIn(ramp(frame, 2 + i * 3, ENTER), size),
                  background: colors.white,
                  color: "#111",
                  fontFamily: fonts.native,
                  fontWeight: 700,
                  fontSize: size * 0.72,
                  lineHeight: 1.12,
                  letterSpacing: "-0.01em",
                  padding: `${0.08 * size}px ${0.3 * size}px ${0.12 * size}px`,
                  borderRadius: 0.22 * size,
                  marginTop: i ? -0.16 * size : 0,
                }}
              >
                {l}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...serif(500), fontSize: size, lineHeight: 1.0, letterSpacing: tracking.display, color, textShadow: dark ? "none" : softShadow(size) }}>
            {main.map((l, i) => line(l, i, "main"))}
            {second.map((l, i) => line(l, i, "muted"))}
          </div>
        )}
        {p.subtitle && (
          <div
            style={{
              ...blurIn(ramp(frame, 3 + wi * STAGGER + 2, ENTER), size * 0.34),
              opacity: 0.85 * ramp(frame, 3 + wi * STAGGER + 2, ENTER),
              ...serif(400, true),
              fontSize: size * 0.34,
              lineHeight: 1.25,
              letterSpacing: tracking.text,
              color: native ? colors.white : color,
              textShadow: dark ? "none" : softShadow(size * 0.34),
              maxWidth: width * 0.8,
            }}
          >
            {p.subtitle}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
