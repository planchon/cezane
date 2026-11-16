import { AbsoluteFill, Freeze, useVideoConfig } from "remotion";
import type { LookProps } from "@cezane/core";
import { fonts } from "./fonts";
import { colors } from "./theme";
import { unit } from "./ui/anim";
import { TimelineView } from "./Timeline";

/** Several labeled frames (of one or several montages) in a single image, so Claude looks once. */
export const Look: React.FC<LookProps> = ({ montage, assets, items, columns }) => {
  const { width: W, height: H } = useVideoConfig();
  const k = unit(W, H);
  const n = Math.max(1, items.length);
  // The column count that shows each frame the biggest.
  let cols = columns ?? 1;
  if (!columns) {
    let best = 0;
    for (let c = 1; c <= n; c++) {
      const s = Math.min(W / c / montage.settings.width, H / Math.ceil(n / c) / montage.settings.height);
      if (s > best + 1e-6) [best, cols] = [s, c];
    }
  }
  const rows = Math.ceil(n / cols);
  const cw = W / cols;
  const ch = H / rows;
  return (
    <AbsoluteFill style={{ background: colors.night }}>
      {items.map((item, i) => {
        const m = item.montage ?? montage;
        const mw = m.settings.width;
        const mh = m.settings.height;
        const r = item.region ?? { x: 0, y: 0, w: 1, h: 1 };
        const s = Math.min(cw / (r.w * mw), ch / (r.h * mh));
        const ox = (cw - r.w * mw * s) / 2 - r.x * mw * s;
        const oy = (ch - r.h * mh * s) / 2 - r.y * mh * s;
        return (
          <div key={i} style={{ position: "absolute", left: (i % cols) * cw, top: Math.floor(i / cols) * ch, width: cw, height: ch, overflow: "hidden", outline: `${2 * k}px solid ${colors.night}` }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: mw, height: mh, transform: `translate(${ox}px, ${oy}px) scale(${s})`, transformOrigin: "0 0" }}>
              <Freeze frame={item.frame}>
                <TimelineView montage={m} assets={assets} />
              </Freeze>
            </div>
            <div style={{ position: "absolute", left: 10 * k, top: 10 * k, padding: `${5 * k}px ${12 * k}px`, borderRadius: 8 * k, background: "rgba(43,42,38,0.85)", color: colors.white, fontFamily: fonts.mono, fontWeight: 700, fontSize: Math.max(18, 26 * k * Math.min(1, cw / 540)) }}>
              {item.label}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
