import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ScreenshotShowcaseProps, WithDuration } from "../catalog";
import { useAssets } from "../context";
import { fonts } from "../fonts";
import { palette } from "../theme";
import { clamp, unit } from "../ui/anim";
import { PaintedBackground } from "../ui/PaintedBackground";

const PHONE_ASPECT = 1179 / 2556;

type Rect = { x: number; y: number; w: number; h: number };

/** Screenshot studio: a capture in a device frame on a painted background, with highlight, zoom and scroll. */
export const ScreenshotShowcase: React.FC<WithDuration<ScreenshotShowcaseProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const k = unit(W, H);
  const asset = useAssets()[p.assetId];
  const aspect = asset?.width && asset?.height ? asset.width / asset.height : p.device === "iphone" ? PHONE_ASPECT : 16 / 10;
  const hasCaption = Boolean(p.caption);
  const captionTop = hasCaption && p.captionPosition === "top";

  // ── Layout (frame coordinates, before animation) ──
  let screen: Rect;
  let frameRect: Rect; // the device body
  const bezel = 16 * k;
  const bar = 66 * k;
  const availH = H * (hasCaption ? 0.66 : 0.8);
  const cy = H * (hasCaption ? (captionTop ? 0.6 : 0.42) : 0.5);
  if (p.device === "iphone") {
    const sh = availH - bezel * 2;
    const sw = Math.min(sh * PHONE_ASPECT, W * 0.8);
    const shh = sw / PHONE_ASPECT;
    screen = { x: (W - sw) / 2, y: cy - shh / 2, w: sw, h: shh };
    frameRect = { x: screen.x - bezel, y: screen.y - bezel, w: sw + bezel * 2, h: shh + bezel * 2 };
  } else if (p.device === "browser") {
    const bw = W * 0.9;
    const ch = Math.min(bw / aspect, availH - bar);
    screen = { x: (W - bw) / 2, y: cy - (ch + bar) / 2 + bar, w: bw, h: ch };
    frameRect = { x: screen.x, y: screen.y - bar, w: bw, h: ch + bar };
  } else {
    const bw = W * 0.86;
    const ch = Math.min(bw / aspect, availH);
    screen = { x: (W - bw) / 2, y: cy - ch / 2, w: bw, h: ch };
    frameRect = screen;
  }
  const imgH = screen.w / aspect; // displayed height of the capture inside the screen
  const overflow = Math.max(0, imgH - screen.h);
  const scrollT = interpolate(frame, [15, Math.max(16, p.duration - 15)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const scrollY = overflow * Math.min(1, p.scroll) * scrollT;

  // ── Animation ──
  const enter = spring({ frame, fps, config: { damping: 17, stiffness: 85, mass: 0.9 } });
  const out = interpolate(frame, [p.duration - 8, p.duration], [1, 0], clamp);
  const zoomT = p.zoom ? spring({ frame: frame - p.zoomAt, fps, config: { damping: 200 }, durationInFrames: 26 }) : 0;
  const hlT = p.highlight ? spring({ frame: frame - p.highlightAt, fps, config: { damping: 200 }, durationInFrames: 16 }) : 0;
  const float = p.float ? Math.sin((frame / fps) * 1.3) * 9 * k : 0;
  const tiltX = p.tilt ? interpolate(enter, [0, 1], [24, 7]) * (1 - zoomT) : 0;
  const tiltY = p.tilt ? Math.sin((frame / fps) * 0.8) * 3 * (1 - zoomT) : 0;

  let zoomTransform = "none";
  if (p.zoom) {
    const r = p.zoom;
    const cx = screen.x + (r.x + r.w / 2) * screen.w;
    const cyz = screen.y + (r.y + r.h / 2) * imgH - scrollY;
    const S = Math.min((W * 0.94) / (r.w * screen.w), (H * 0.62) / (r.h * imgH), 3.4);
    const s = 1 + (S - 1) * zoomT;
    zoomTransform = `translate(${(W / 2 - cx * S) * zoomT}px, ${(H / 2 - cyz * S) * zoomT}px) scale(${s})`;
  }

  const media = !asset ? (
    <AbsoluteFill style={{ background: palette.paper, alignItems: "center", justifyContent: "center", fontFamily: fonts.ui, color: palette.ink, fontSize: 30 * k }}>{p.assetId}</AbsoluteFill>
  ) : asset.kind === "video" ? (
    <OffthreadVideo src={asset.url} muted style={{ width: screen.w, height: imgH, objectFit: "cover", display: "block" }} />
  ) : (
    <Img src={asset.url} style={{ width: screen.w, height: imgH, display: "block", transform: `translateY(${-scrollY}px)` }} />
  );

  const screenRadius = p.device === "iphone" ? screen.w * 0.13 : p.device === "none" ? 22 * k : 0;
  const hl = p.highlight;

  const captionWords = (p.caption ?? "").split(" ");
  const caption = hasCaption && (
    <div
      style={{
        position: "absolute",
        left: W * 0.07,
        right: W * 0.07,
        ...(captionTop ? { top: H * 0.075 } : { bottom: H * 0.075 }),
        textAlign: "center",
        fontFamily: fonts.serif,
        fontWeight: 700,
        fontSize: 76 * k,
        lineHeight: 1.08,
        letterSpacing: "-0.015em",
        color: p.captionColor,
      }}
    >
      {captionWords.map((w, i) => {
        const s = spring({ frame: frame - 4 - i * 2, fps, config: { damping: 200 }, durationInFrames: 14 });
        return (
          <span key={i} style={{ display: "inline-block", marginRight: "0.25em", opacity: s, transform: `translateY(${(1 - s) * 24 * k}px)` }}>
            {w}
          </span>
        );
      })}
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity: out }}>
      <PaintedBackground background={p.background} />
      <AbsoluteFill style={{ transform: zoomTransform, transformOrigin: "0 0" }}>
        {caption}
        <AbsoluteFill style={{ perspective: 2400 * k }}>
          <div
            style={{
              position: "absolute",
              left: frameRect.x,
              top: frameRect.y,
              width: frameRect.w,
              height: frameRect.h,
              transform: `translateY(${(1 - enter) * H * 0.4 + float}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
              transformOrigin: "50% 60%",
              opacity: interpolate(enter, [0, 0.25], [0, 1], clamp),
            }}
          >
            {/* Device body */}
            {p.device === "iphone" && (
              <div style={{ position: "absolute", inset: 0, borderRadius: screenRadius + bezel, background: "linear-gradient(145deg, #3a3936 0%, #141311 40%, #2b2a27 100%)", boxShadow: `0 ${60 * k}px ${120 * k}px rgba(30,26,20,0.45), 0 ${16 * k}px ${30 * k}px rgba(30,26,20,0.35), inset 0 0 0 ${2 * k}px #55524c` }} />
            )}
            {p.device === "browser" && (
              <div style={{ position: "absolute", inset: 0, borderRadius: 22 * k, background: palette.paper, boxShadow: `0 ${50 * k}px ${110 * k}px rgba(30,26,20,0.42), 0 ${12 * k}px ${26 * k}px rgba(30,26,20,0.25)`, overflow: "hidden" }}>
                <div style={{ height: bar, display: "flex", alignItems: "center", gap: 12 * k, padding: `0 ${24 * k}px`, borderBottom: `1px solid rgba(43,42,38,0.1)`, background: "#EFE7D6" }}>
                  {["#E0665A", "#E5B84B", "#6EAE63"].map((c) => (
                    <div key={c} style={{ width: 18 * k, height: 18 * k, borderRadius: 99, background: c }} />
                  ))}
                  <div style={{ flex: 1, marginLeft: 22 * k, marginRight: 60 * k, height: 38 * k, borderRadius: 99, background: palette.paper, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fonts.ui, fontWeight: 500, fontSize: 22 * k, color: "#6d675c" }}>
                    {p.url ?? ""}
                  </div>
                </div>
              </div>
            )}
            {p.device === "none" && <div style={{ position: "absolute", inset: 0, borderRadius: screenRadius, boxShadow: `0 ${50 * k}px ${110 * k}px rgba(30,26,20,0.42)` }} />}

            {/* Screen */}
            <div
              style={{
                position: "absolute",
                left: screen.x - frameRect.x,
                top: screen.y - frameRect.y,
                width: screen.w,
                height: screen.h,
                borderRadius: p.device === "browser" ? `0 0 ${22 * k}px ${22 * k}px` : screenRadius,
                overflow: "hidden",
                background: "#000",
              }}
            >
              {media}
              {hl && (
                <div
                  style={{
                    position: "absolute",
                    left: hl.x * screen.w,
                    top: hl.y * imgH - scrollY,
                    width: hl.w * screen.w,
                    height: hl.h * imgH,
                    borderRadius: 16 * k,
                    boxShadow: `0 0 0 ${3000 * k}px rgba(16,14,11,${0.6 * hlT}), 0 0 0 ${5 * k}px rgba(232,176,74,${hlT})`,
                    transform: `scale(${interpolate(hlT, [0, 1], [1.15, 1])})`,
                  }}
                />
              )}
              {p.device === "iphone" && (
                <div style={{ position: "absolute", top: screen.w * 0.03, left: "50%", width: screen.w * 0.3, height: screen.w * 0.085, transform: "translateX(-50%)", borderRadius: 99, background: "#000" }} />
              )}
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
