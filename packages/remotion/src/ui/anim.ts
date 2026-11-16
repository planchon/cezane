import { interpolate, spring } from "remotion";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0→1 when entering (spring), 1→0 over the last `exitFrames` frames. */
export function enterExit(frame: number, fps: number, duration: number, opts: { delay?: number; exitFrames?: number; damping?: number; stiffness?: number } = {}) {
  const enter = spring({ frame: frame - (opts.delay ?? 0), fps, config: { damping: opts.damping ?? 18, stiffness: opts.stiffness ?? 160, mass: 0.7 } });
  const exitFrames = opts.exitFrames ?? 8;
  const exit = interpolate(frame, [duration - exitFrames, duration], [1, 0], clamp);
  return { enter, exit, both: Math.min(enter, exit) };
}

/** Scale factor so designs made for a 1080-wide frame fit any frame size. */
export const unit = (width: number, height: number) => Math.min(width / 1080, height / 1920) * (width > height ? 1.6 : 1);

export const verticalCenter = (position: "top" | "center" | "bottom") => (position === "top" ? 0.22 : position === "center" ? 0.5 : 0.72);

/** Thick text outline that renders the same in every Chrome version. */
export const outline = (w: number, color: string) => {
  const out: string[] = [];
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    out.push(`${(Math.cos(t) * w).toFixed(1)}px ${(Math.sin(t) * w).toFixed(1)}px 0 ${color}`);
  }
  return out.join(",");
};
