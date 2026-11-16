import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { painted, resolveBackground } from "../theme";

/** A background in the Cézanne palette; named presets get a constructive diagonal brush texture. */
export const PaintedBackground: React.FC<{ background: string; drift?: boolean }> = ({ background, drift = true }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const scale = drift ? interpolate(frame, [0, Math.max(1, durationInFrames)], [1.06, 1]) : 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ background: resolveBackground(background), transform: `scale(${scale})` }} />
      {painted(background) && (
        <>
          <svg width={width * 1.6} height={height * 1.6} style={{ position: "absolute", left: -width * 0.3, top: -height * 0.3, transform: "rotate(-32deg)", mixBlendMode: "multiply", opacity: 0.55 }}>
            <filter id="cz-strokes">
              <feTurbulence type="fractalNoise" baseFrequency="0.004 0.09" numOctaves={3} seed={11} />
              <feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.30  0 0 0 0 0.22  0 0 0 0.55 -0.12" />
            </filter>
            <rect width="100%" height="100%" filter="url(#cz-strokes)" />
          </svg>
          <svg width={width * 1.6} height={height * 1.6} style={{ position: "absolute", left: -width * 0.3, top: -height * 0.3, transform: "rotate(28deg)", mixBlendMode: "soft-light", opacity: 0.7 }}>
            <filter id="cz-strokes-2">
              <feTurbulence type="fractalNoise" baseFrequency="0.006 0.05" numOctaves={2} seed={3} />
              <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.9  0 0 0 0.6 -0.2" />
            </filter>
            <rect width="100%" height="100%" filter="url(#cz-strokes-2)" />
          </svg>
          <AbsoluteFill style={{ background: "radial-gradient(ellipse 90% 70% at 50% 45%, rgba(0,0,0,0) 55%, rgba(43,42,38,0.28) 100%)" }} />
        </>
      )}
    </AbsoluteFill>
  );
};
