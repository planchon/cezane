import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CalloutProps, WithDuration } from "../catalog";
import { fonts } from "../fonts";
import { palette } from "../theme";
import { clamp, unit } from "../ui/anim";

export const Callout: React.FC<WithDuration<CalloutProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = unit(width, height);
  const lx = (p.labelX ?? Math.min(0.78, Math.max(0.22, p.x < 0.5 ? p.x + 0.2 : p.x - 0.2))) * width;
  const ly = (p.labelY ?? (p.y > 0.5 ? p.y - 0.15 : p.y + 0.15)) * height;
  const tx = p.x * width;
  const ty = p.y * height;
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 190, mass: 0.6 } });
  const draw = interpolate(frame, [5, 20], [0, 1], clamp);
  const out = interpolate(frame, [p.duration - 8, p.duration], [1, 0], clamp);
  // Arrow leaves the label edge facing the target and bends a little.
  const sy = ly + (ty > ly ? 48 : -48) * k;
  const mx = (lx + tx) / 2 + (tx > lx ? -1 : 1) * 90 * k;
  const my = (sy + ty) / 2;
  const angle = Math.atan2(ty - my, tx - mx);
  const head = 26 * k;
  const ring = (frame % 30) / 30;
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <path d={`M ${lx} ${sy} Q ${mx} ${my} ${tx} ${ty}`} fill="none" stroke={p.color} strokeWidth={9 * k} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.35))" }} />
        {draw > 0.95 && (
          <path
            d={`M ${tx} ${ty} L ${tx - head * Math.cos(angle - 0.45)} ${ty - head * Math.sin(angle - 0.45)} M ${tx} ${ty} L ${tx - head * Math.cos(angle + 0.45)} ${ty - head * Math.sin(angle + 0.45)}`}
            stroke={p.color}
            strokeWidth={9 * k}
            strokeLinecap="round"
          />
        )}
        <circle cx={tx} cy={ty} r={(16 + ring * 40) * k} fill="none" stroke={p.color} strokeWidth={4 * k} opacity={(1 - ring) * draw} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: lx,
          top: ly,
          transform: `translate(-50%, -50%) scale(${pop})`,
          background: p.color,
          color: palette.ink,
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: 50 * k,
          padding: `${14 * k}px ${30 * k}px`,
          borderRadius: 999,
          whiteSpace: "nowrap",
          boxShadow: "0 14px 36px rgba(0,0,0,0.35)",
        }}
      >
        {p.label}
      </div>
    </AbsoluteFill>
  );
};
