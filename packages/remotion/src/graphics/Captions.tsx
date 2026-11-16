import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { captionPages, type CaptionWord } from "@cezane/core";
import { fonts } from "../fonts";
import { palette } from "../theme";
import { clamp, outline, unit, verticalCenter } from "../ui/anim";

type Props = {
  words: CaptionWord[];
  style: "bold" | "karaoke" | "minimal" | "box";
  position: "top" | "center" | "bottom";
  color?: string;
  duration: number;
};

/** A page stays on screen until the next page starts, at most this many frames after its last word. */
const HOLD = 12;

/**
 * Word-by-word captions. Everything depends only on each word's timing relative to the clip,
 * so a segment rendered alone matches the same frames of a full render.
 */
export const Captions: React.FC<Props> = ({ words, style, position, color }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
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
  const accent = color ?? (style === "box" ? palette.terracotta : palette.gold);
  const enter = spring({ frame: frame - start, fps, config: { damping: 15, stiffness: 240, mass: 0.6 } });

  const size = { bold: 90, karaoke: 78, minimal: 62, box: 66 }[style] * k;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${verticalCenter(position) * 100}%`,
          transform: `translateY(-50%) scale(${interpolate(enter, [0, 1], [0.86, 1])})`,
          opacity: interpolate(enter, [0, 0.35], [0, 1], clamp),
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          columnGap: style === "box" ? 12 * k : size * 0.32,
          rowGap: style === "box" ? 12 * k : size * 0.06,
          padding: `0 ${80 * k}px`,
        }}
      >
        {page.map((w, i) => {
          const next = page[i + 1];
          const active = frame >= w.start && frame < (next ? next.start : w.end + HOLD);
          const spoken = frame >= w.start;
          const pop = spring({ frame: frame - w.start, fps, config: { damping: 10, stiffness: 260, mass: 0.5 } });
          const scale = active ? interpolate(pop, [0, 1], [0.94, 1.06]) : 1;
          const text = style === "bold" ? w.text.toUpperCase() : w.text;
          if (style === "box") {
            return (
              <span
                key={i}
                style={{
                  fontFamily: fonts.display,
                  fontWeight: 800,
                  fontSize: size,
                  lineHeight: 1.15,
                  padding: `${4 * k}px ${16 * k}px`,
                  borderRadius: 12 * k,
                  background: active ? accent : palette.cream,
                  color: active ? palette.cream : palette.ink,
                  transform: `scale(${scale}) rotate(${active ? -2 : 0}deg)`,
                  boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
                }}
              >
                {text}
              </span>
            );
          }
          if (style === "karaoke") {
            return (
              <span
                key={i}
                style={{
                  fontFamily: fonts.display,
                  fontWeight: 800,
                  fontSize: size,
                  lineHeight: 1.2,
                  padding: `0 ${12 * k}px`,
                  borderRadius: 14 * k,
                  background: active ? accent : "transparent",
                  color: active ? palette.ink : "#FFFFFF",
                  opacity: spoken ? 1 : 0.72,
                  transform: `scale(${scale})`,
                  textShadow: active ? "none" : `${outline(4 * k, "rgba(16,14,11,0.85)")}`,
                }}
              >
                {text}
              </span>
            );
          }
          if (style === "minimal") {
            return (
              <span key={i} style={{ fontFamily: fonts.ui, fontWeight: 700, fontSize: size, lineHeight: 1.2, color: "#FFFFFF", opacity: spoken ? 1 : 0.45, textShadow: "0 3px 14px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.6)" }}>
                {text}
              </span>
            );
          }
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                fontFamily: fonts.display,
                fontWeight: 900,
                fontSize: size,
                lineHeight: 1.1,
                letterSpacing: "-0.01em",
                color: active ? accent : "#FFFFFF",
                transform: `scale(${scale})`,
                textShadow: `${outline(size * 0.075, "#14120E")}, 0 ${size * 0.1}px ${size * 0.2}px rgba(0,0,0,0.45)`,
              }}
            >
              {text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
