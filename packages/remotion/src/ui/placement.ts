import type { SubjectPlacement } from "@cezane/core";
import { verticalCenter } from "./anim";

/** Highest top of a text drawn behind a person (below the TikTok top tabs). */
const MIN_TOP = 0.06;

/**
 * Layout of a text block of height `h` (share of the frame) behind a person: centered on the top
 * of the head, so the top half of the letters stays clear and the head hides part of the bottom
 * half. `maxH` is the tallest block that still fits above. Without a usable subject: `position`.
 */
export function behindLayout(subject: SubjectPlacement | undefined, h: number, position: "top" | "center" | "bottom"): { y: number; maxH: number } {
  if (!subject?.usable) return { y: verticalCenter(position), maxH: 1 };
  const maxH = 2 * (subject.headTop - MIN_TOP);
  return { y: subject.headTop, maxH: Math.max(0.04, maxH) };
}

export const behindY = (subject: SubjectPlacement | undefined, h: number, position: "top" | "center" | "bottom") => behindLayout(subject, h, position).y;
