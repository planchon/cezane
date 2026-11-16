import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { FlashProps, WithDuration } from "../catalog";
import { clamp } from "../ui/anim";

export const Flash: React.FC<WithDuration<FlashProps>> = (p) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 2, Math.max(3, p.duration)], [0, 0.95, 0], clamp);
  return <AbsoluteFill style={{ background: p.color, opacity }} />;
};
