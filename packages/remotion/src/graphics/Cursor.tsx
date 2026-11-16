import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CursorProps, WithDuration } from "../catalog";
import { clamp, fadeOut, ramp, unit } from "../ui/anim";
import { ClickRipple, CursorTag, glide } from "../ui/CursorTag";

/** Figma-style cursor with a name tag that glides to a spot and optionally clicks it. */
export const Cursor: React.FC<WithDuration<CursorProps>> = (p) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const k = unit(W, H);
  const to = { x: p.x * W, y: p.y * H };
  const from = {
    x: (p.fromX ?? Math.min(0.9, p.x + 0.22)) * W,
    y: (p.fromY ?? Math.min(0.92, p.y + 0.16)) * H,
  };
  const start = 4;
  const pos = glide(frame, from, to, start, p.moveFrames);
  const clickAt = start + p.moveFrames + 4;
  const press = p.click ? interpolate(frame, [clickAt, clickAt + 3, clickAt + 8], [0, 1, 0], clamp) : 0;
  const ripple = p.click ? (frame - clickAt) / (0.7 * fps) : 0;
  const appear = ramp(frame, 0, 8);
  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame, p.duration, 8) }}>
      <ClickRipple x={to.x} y={to.y} k={k} color={p.color} t={ripple} />
      <CursorTag x={pos.x} y={pos.y} k={k} color={p.color} label={p.label} press={press} opacity={appear} labelT={ramp(frame, 3, 10)} />
    </AbsoluteFill>
  );
};
