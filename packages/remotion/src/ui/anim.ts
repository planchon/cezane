import type { CSSProperties } from "react";
import { Easing, interpolate } from "remotion";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The house easing (ease-out quint-like), used by every entrance. */
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

/** 0→1 over `frames` frames starting at `delay`, with the house easing. */
export const ramp = (frame: number, delay: number, frames: number, easing = easeOut) =>
  interpolate(frame - delay, [0, Math.max(1, frames)], [0, 1], { ...clamp, easing });

/** 1→0 over the last `frames` frames of a clip. */
export const fadeOut = (frame: number, duration: number, frames = 8) => interpolate(frame, [duration - frames, duration], [1, 0], clamp);

/**
 * The house text entrance: each word fades in from a slight blur while rising 0.2em.
 * Returns the style of one word; `t` comes from `ramp`.
 */
export const blurIn = (t: number, fontSize: number): CSSProperties => ({
  display: "inline-block",
  opacity: t,
  filter: t < 1 ? `blur(${((1 - t) * fontSize * 0.08).toFixed(2)}px)` : undefined,
  transform: t < 1 ? `translateY(${((1 - t) * fontSize * 0.2).toFixed(2)}px)` : undefined,
});

/** Exit mirror of `blurIn`: the word drifts up 0.2em while blurring out (`t` goes 1→0). */
export const blurOut = (t: number, fontSize: number): CSSProperties => ({
  opacity: t,
  filter: t < 1 ? `blur(${((1 - t) * fontSize * 0.08).toFixed(2)}px)` : undefined,
  transform: t < 1 ? `translateY(${(-(1 - t) * fontSize * 0.2).toFixed(2)}px)` : undefined,
});

/** Words entering one after the other: the delay of word i. */
export const STAGGER = 2;
export const ENTER = 13;

/** Scale factor so designs made for a 1080-wide frame fit any frame size. */
export const unit = (width: number, height: number) => Math.min(width / 1080, height / 1920) * (width > height ? 1.6 : 1);

export const verticalCenter = (position: "top" | "center" | "bottom") => (position === "top" ? 0.22 : position === "center" ? 0.5 : 0.7);

/** Soft shadow that keeps white text readable on footage without an outline. */
export const softShadow = (size: number) => `0 ${(size * 0.02).toFixed(1)}px ${(size * 0.1).toFixed(1)}px rgba(0,0,0,0.28), 0 ${(size * 0.06).toFixed(1)}px ${(size * 0.4).toFixed(1)}px rgba(0,0,0,0.3)`;

/** Hard text outline (TikTok "classic" stroke) that renders the same in every Chrome version. */
export const outline = (w: number, color: string) => {
  const out: string[] = [];
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    out.push(`${(Math.cos(t) * w).toFixed(1)}px ${(Math.sin(t) * w).toFixed(1)}px 0 ${color}`);
  }
  return out.join(",");
};
