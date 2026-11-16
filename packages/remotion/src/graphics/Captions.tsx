import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { captionPages, type CaptionStyle, type CaptionWord } from "@cezane/core";
import { fonts, serif, tracking } from "../fonts";
import { colors, isLightColor } from "../theme";
import { outline, ramp, softShadow, unit } from "../ui/anim";

type Props = {
  words: CaptionWord[];
  style: CaptionStyle;
  position: "top" | "center" | "bottom";
  y?: number;
  color?: string;
  duration: number;
  /** Ranges (clip frames) where a boxed cutout fills the lower frame: captions go just above it. */
  raises?: { start: number; end: number; y: number }[];
  /** Ranges (clip frames) where a screenshot scene is on: captions get a dark backing box to stay legible. */
  screens?: { start: number; end: number }[];
};

/** A page stays on screen until the next page starts, at most this many frames after its last word. */
const HOLD = 12;
/** Vertical centers: below the eyes and above the TikTok bottom UI (y 0.65 ≈ 1250 px). */
const Y = { top: 0.3, center: 0.5, bottom: 0.65 } as const;
const SIZE: Record<CaptionStyle, number> = { clean: 84, native: 70, pill: 74, box: 64, caps: 92 };

/** Sentence-style display: no trailing period or comma, as people type captions. */
const tidy = (s: string, caps: boolean) => {
  const t = s.trim().replace(/[.,;:]+$/u, "");
  return caps ? t.toUpperCase() : t;
};

/**
 * Word-by-word captions. Everything depends only on each word's timing relative to the clip,
 * so a segment rendered alone matches the same frames of a full render.
 * Text stays inside x 120–960 (TikTok right rail) on one line of 2–4 words.
 */
export const Captions: React.FC<Props> = ({ words, style, position, y, color, raises, screens }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const k = unit(width, height);
  const pages = captionPages(words);
  let page: CaptionWord[] | undefined;
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i]!;
    const start = pg[0]!.start;
    const end = Math.min(pages[i + 1]?.[0]?.start ?? Number.POSITIVE_INFINITY, pg.at(-1)!.end + HOLD);
    if (frame >= start && frame < end) {
      page = pg;
      break;
    }
  }
  if (!page) return null;
  const start = page[0]!.start;
  // One line: a long page shrinks a little rather than wrapping (about 18 characters fit at full size).
  const chars = page.reduce((n, w) => n + w.text.trim().length + 1, -1);
  const fit = style === "clean" || style === "native" ? Math.max(0.72, Math.min(1, 18 / Math.max(1, chars))) : 1;
  const size = SIZE[style] * k * fit;
  const caps = style === "caps";
  const pageIn = ramp(frame, start, 4);
  const activeIndex = page.findLastIndex((w) => frame >= w.start);

  const words$ = page.map((w, i) => {
    const text = tidy(w.text, caps);
    const spoken = frame >= w.start;
    const active = i === activeIndex;
    if (style === "clean") {
      // Read ahead: the whole page is there, words light up (never change color) as they are said.
      const said = ramp(frame, w.start - 1, 3);
      return (
        <span key={i} style={{ whiteSpace: "pre", opacity: 0.4 + 0.6 * said }}>
          {text}
        </span>
      );
    }
    if (style === "pill") {
      const pill = color ?? colors.white;
      const onPill = isLightColor(pill) ? colors.ink : colors.white;
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            padding: `0 ${0.2 * size}px ${0.06 * size}px`,
            margin: `0 ${-0.2 * size}px`,
            borderRadius: 0.24 * size,
            background: active ? pill : "transparent",
            color: active ? onPill : colors.white,
            opacity: spoken ? 1 : 0.55,
            textShadow: active ? "none" : softShadow(size),
          }}
        >
          {text}
        </span>
      );
    }
    if (style === "caps") {
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            color: active ? (color ?? "#F7C204") : colors.white,
            transform: `scale(${active ? 1.08 : 1})`,
            textShadow: `${outline(size * 0.06, "#111")}, 0 ${size * 0.08}px ${size * 0.2}px rgba(0,0,0,0.4)`,
          }}
        >
          {text}
        </span>
      );
    }
    return <span key={i}>{text}</span>; // native and box show the whole page at once
  });

  const boxColor = color ?? "rgba(0,0,0,0.62)";
  const container: React.CSSProperties =
    style === "native"
      ? { fontFamily: fonts.native, fontWeight: 700, letterSpacing: "-0.01em", color: colors.white, textShadow: outline(size * 0.065, "#000"), opacity: pageIn }
      : style === "box"
        ? {
            fontFamily: fonts.sans,
            fontWeight: 600,
            letterSpacing: tracking.text,
            color: isLightColor(boxColor) ? colors.ink : colors.white,
            background: boxColor,
            padding: `${0.12 * size}px ${0.38 * size}px ${0.16 * size}px`,
            borderRadius: 0.28 * size,
            opacity: pageIn,
          }
        : caps
          ? { fontFamily: fonts.sans, fontWeight: 800, letterSpacing: "-0.02em" }
          : { ...serif(600), letterSpacing: tracking.text, color: colors.white, opacity: pageIn, textShadow: `0 0 ${2 * k}px rgba(0,0,0,0.35), ${softShadow(size)}` };

  // Over a busy screen, open styles get the native caption box behind them.
  const onScreen = (style === "clean" || style === "pill" || style === "native") && screens?.some((r) => frame >= r.start && frame < r.end);
  const backing: React.CSSProperties = onScreen
    ? { background: "rgba(16,16,15,0.66)", padding: `${0.1 * size}px ${0.34 * size}px ${0.14 * size}px`, borderRadius: 0.28 * size, textShadow: "none" }
    : {};

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 120 * k,
          right: 120 * k,
          top: `${Math.min(y ?? Y[position], raises?.find((r) => frame >= r.start && frame < r.end)?.y ?? 1) * 100}%`,
          transform: "translateY(-50%)",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "baseline",
            columnGap: size * 0.26,
            rowGap: size * 0.04,
            fontSize: size,
            lineHeight: 1.12,
            textAlign: "center",
            ...container,
            ...backing,
          }}
        >
          {words$}
        </div>
      </div>
    </AbsoluteFill>
  );
};
