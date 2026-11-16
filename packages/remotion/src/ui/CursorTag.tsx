import { Easing, interpolate } from "remotion";
import { fonts, tracking } from "../fonts";
import { clamp } from "./anim";

/**
 * A Figma-style multiplayer cursor: a colored arrowhead with a white edge and a name tag in
 * the same color. (x, y) is the tip, in px of the parent. `press` 0..1 squashes it for a click.
 */
export const CursorTag: React.FC<{ x: number; y: number; k: number; color: string; label?: string; press?: number; opacity?: number; labelT?: number }> = ({
  x,
  y,
  k,
  color,
  label,
  press = 0,
  opacity = 1,
  labelT = 1,
}) => {
  const s = 4.4 * k; // arrow path units → px
  const squash = 1 - 0.14 * press;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${squash})`, transformOrigin: "0 0", pointerEvents: "none" }}>
      <svg width={22 * s} height={22 * s} viewBox="0 0 22 22" style={{ position: "absolute", left: -2 * s, top: -2 * s, overflow: "visible", filter: `drop-shadow(0 ${3 * k}px ${6 * k}px rgba(0,0,0,0.28))` }}>
        <path d="M2 2 L19.5 9.2 L11.6 11.6 L9.2 19.5 Z" fill={color} stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
      {label && (
        <div
          style={{
            position: "absolute",
            left: 14 * s,
            top: 14 * s,
            whiteSpace: "nowrap",
            background: color,
            color: "#fff",
            fontFamily: fonts.sans,
            fontWeight: 600,
            fontSize: 40 * k,
            letterSpacing: tracking.text,
            lineHeight: 1,
            padding: `${13 * k}px ${22 * k}px ${14 * k}px`,
            borderRadius: 14 * k,
            boxShadow: `0 ${4 * k}px ${14 * k}px rgba(0,0,0,0.2), inset 0 0 0 ${1.5 * k}px rgba(255,255,255,0.25)`,
            opacity: labelT,
            transform: `scale(${0.85 + 0.15 * labelT})`,
            transformOrigin: "0 0",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
};

/** Expanding rings where a click lands. `t` 0..1 since the click. */
export const ClickRipple: React.FC<{ x: number; y: number; k: number; color: string; t: number }> = ({ x, y, k, color, t }) => {
  if (t <= 0 || t >= 1) return null;
  return (
    <>
      {[0, 0.25].map((d) => {
        const u = Math.max(0, Math.min(1, (t - d) / (1 - d)));
        const r = (18 + u * 90) * k;
        return u > 0 && u < 1 ? (
          <div key={d} style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: 999, border: `${4 * k * (1 - u)}px solid ${color}`, opacity: 1 - u }} />
        ) : null;
      })}
    </>
  );
};

/** Path of a cursor gliding from one point to another along a slight arc. All coordinates in px. */
export function glide(frame: number, from: { x: number; y: number }, to: { x: number; y: number }, start: number, frames: number) {
  const t = interpolate(frame - start, [0, Math.max(1, frames)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bend = Math.sin(t * Math.PI) * 0.12; // perpendicular offset, share of the distance
  return { x: from.x + dx * t - dy * bend, y: from.y + dy * t + dx * bend, arrived: t >= 1 };
}

/** A point of a cursor path: arrive at (x, y) at frame `at`; a drag then moves to (x2, y2) over `dur`. */
export type PathKey = { at: number; x: number; y: number; x2?: number; y2?: number; dur?: number; click?: boolean; label?: string };

/**
 * Where a cursor following real interactions is at `frame`: it glides to each point just before its
 * time, presses for clicks, drags along scrolls. Coordinates stay in the units of the keys.
 */
export function followPath(frame: number, keys: PathKey[], fps: number) {
  const ks = [...keys].sort((a, b) => a.at - b.at);
  const first = ks[0];
  if (!first) return undefined;
  const endOf = (k: PathKey) => ({ x: k.x2 ?? k.x, y: k.y2 ?? k.y, at: k.at + (k.x2 !== undefined ? (k.dur ?? Math.round(fps * 0.9)) : 0) });
  const travelFor = (i: number) => {
    const prevEnd = i > 0 ? endOf(ks[i - 1]!).at : -Infinity;
    return Math.max(4, Math.min(18, ks[i]!.at - prevEnd - 2));
  };
  let x = Math.min(0.95, first.x + 0.18);
  let y = Math.min(0.95, first.y + 0.14);
  let press = 0;
  let label: string | undefined;
  let labelT = 0;
  const ripples: { x: number; y: number; t: number }[] = [];
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]!;
    const travel = travelFor(i);
    const start = k.at - travel;
    if (frame < start) break;
    const from = { x, y };
    const t = Math.min(1, (frame - start) / travel);
    x = from.x + (k.x - from.x) * ease(t);
    y = from.y + (k.y - from.y) * ease(t);
    if (k.label && frame >= start - 6 && frame <= k.at + 36) {
      label = k.label;
      labelT = Math.min(1, (frame - (start - 6)) / 8) * Math.min(1, (k.at + 36 - frame) / 8);
    }
    if (frame < k.at) continue;
    const end = endOf(k);
    if (k.x2 !== undefined) {
      // drag: pressed while it moves
      const u = Math.min(1, (frame - k.at) / Math.max(1, end.at - k.at));
      x = k.x + (end.x - k.x) * ease(u);
      y = k.y + (end.y - k.y) * ease(u);
      press = frame <= end.at + 2 ? Math.min(1, (frame - k.at + 1) / 3) : Math.max(0, 1 - (frame - end.at - 2) / 4);
    } else if (k.click) {
      press = interpolate(frame, [k.at, k.at + 3, k.at + 8], [0, 1, 0], clamp);
      ripples.push({ x: k.x, y: k.y, t: (frame - k.at) / (0.7 * fps) });
    }
  }
  const appear = Math.min(1, Math.max(0, (frame - (first.at - travelFor(0) - 10)) / 8));
  return { x, y, press, opacity: appear, label, labelT, ripples };
}
