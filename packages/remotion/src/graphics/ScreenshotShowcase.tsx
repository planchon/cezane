import { AbsoluteFill, Img, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import type { ScreenshotShowcaseProps, WithDuration } from "../catalog";
import { useAssets } from "../context";
import { fonts, serif, tracking } from "../fonts";
import { colors, isLight } from "../theme";
import { blurIn, clamp, ENTER, fadeOut, ramp, STAGGER, unit } from "../ui/anim";
import { Backdrop } from "../ui/Backdrop";
import { ClickRipple, CursorTag, followPath, glide, type PathKey } from "../ui/CursorTag";
import { Label } from "../ui/Label";

const PHONE_ASPECT = 1179 / 2556;
type Rect = { x: number; y: number; w: number; h: number };

/** Rough line count of a text block, to place what comes under it. */
const lineCount = (text: string, maxWidth: number, size: number) =>
  text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil((l.length * size * 0.5) / maxWidth)), 0);

/**
 * Screenshot studio for docs, onboarding and help videos: a capture in a real-looking device on
 * a painted plate, a two-tone headline with a mono label, and focus tools (Figma cursor, loupe,
 * highlight, zoom, scroll). Lays out for portrait and landscape frames.
 */
export const ScreenshotShowcase: React.FC<WithDuration<ScreenshotShowcaseProps>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const k = unit(W, H);
  const portrait = H >= W;
  const asset = useAssets()[p.assetId];
  const crop = p.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const fullAspect = asset?.width && asset?.height ? asset.width / asset.height : p.device === "iphone" ? PHONE_ASPECT : 16 / 10;
  const aspect = fullAspect * (crop.w / crop.h); // of the part shown
  const light = isLight(p.background);
  const ink = p.captionColor ?? (light ? colors.ink : colors.white);
  const hasText = Boolean(p.caption || p.label);

  // ── Text block ──
  const fs = (portrait ? 96 : 78) * k;
  const textLeft = portrait ? 84 * k : W * 0.06;
  const textWidth = portrait ? W - 168 * k : W * 0.32;
  const labelH = p.label ? 54 * k + 30 * k : 0;
  const lines = (p.caption ? lineCount(p.caption, textWidth, fs) : 0) + (p.muted ? lineCount(p.muted, textWidth, fs) : 0);
  const textH = labelH + lines * fs * 1.02;
  const textTop = portrait ? (p.captionPosition === "bottom" ? H - 170 * k - textH : 150 * k) : (H - textH) / 2;

  // ── Device layout (before animation) ──
  const bleed = p.bleed && portrait && hasText && p.captionPosition !== "bottom";
  const area: Rect = portrait
    ? hasText
      ? p.captionPosition === "bottom"
        ? { x: 0, y: 110 * k, w: W, h: textTop - 200 * k }
        : { x: 0, y: textTop + textH + 80 * k, w: W, h: H - (textTop + textH + 80 * k) - 110 * k }
      : { x: 0, y: H * 0.08, w: W, h: H * 0.84 }
    : hasText
      ? { x: W * 0.41, y: H * 0.08, w: W * 0.56, h: H * 0.84 }
      : { x: W * 0.08, y: H * 0.08, w: W * 0.84, h: H * 0.84 };

  let body: Rect; // the device outline
  let screen: Rect; // the capture area, in body coordinates
  let edge = 0;
  let bezel = 0;
  const bar = p.device === "browser" ? 58 * k : 0;
  if (p.device === "iphone") {
    const shape = aspect < 0.6 ? aspect : PHONE_ASPECT;
    const fromWidth = Math.min(area.w * (portrait ? 0.66 : 0.6), W * 0.7);
    const ratio = (w: number) => (w * (1 - 2 * 0.042)) / shape + w * 2 * 0.042; // outer height for an outer width
    let fw = bleed ? fromWidth : Math.min(fromWidth, (area.h / ratio(1)) * 1);
    if (!bleed && ratio(fw) > area.h) fw = area.h / ratio(1);
    edge = fw * 0.012;
    bezel = fw * 0.03;
    const sw = fw - 2 * (edge + bezel);
    const sh = sw / shape;
    const fh = sh + 2 * (edge + bezel);
    body = { x: area.x + (area.w - fw) / 2, y: bleed ? area.y : area.y + (area.h - fh) / 2, w: fw, h: fh };
    screen = { x: edge + bezel, y: edge + bezel, w: sw, h: sh };
  } else {
    const bw = Math.min(area.w * (portrait ? 0.9 : 0.96), (area.h - bar) * aspect * 1.6);
    const ch = Math.min(bw / aspect, area.h - bar);
    // Under a portrait headline the window hangs from the top of its area; otherwise it is centered.
    const top = portrait && hasText && p.captionPosition !== "bottom" ? area.y : area.y + (area.h - ch - bar) / 2;
    body = { x: area.x + (area.w - bw) / 2, y: top, w: bw, h: ch + bar };
    screen = { x: 0, y: bar, w: bw, h: ch };
  }
  // The full capture is drawn scaled so that the crop fills the screen width.
  const fullW = screen.w / crop.w;
  const fullH = fullW / fullAspect;
  const imgH = screen.w / aspect; // height of the shown part
  const overflow = Math.max(0, imgH - screen.h);
  const scrollT = interpolate(frame, [20, Math.max(21, p.duration - 20)], [0, 1], { ...clamp, easing: (t) => t * t * (3 - 2 * t) });
  const scrollY = overflow * Math.min(1, p.scroll) * scrollT;
  /** A point of the capture (0..1 of the full image) in body coordinates. */
  const at = (x: number, y: number) => ({ x: screen.x + (x - crop.x) * fullW, y: screen.y + (y - crop.y) * fullH - scrollY });

  // ── Animation ──
  const enter = ramp(frame, 2, 24);
  const out = fadeOut(frame, p.duration, 8);
  const float = p.float ? Math.sin((frame / fps) * 1.1) * 6 * k : 0;
  const tiltT = p.tilt ? 1 : 0;
  const zoomT = p.zoom ? ramp(frame, p.zoomAt, 26) : 0;
  const hlT = p.highlight ? ramp(frame, p.highlightAt, 14) : 0;

  let camera = "none";
  if (p.zoom) {
    const r = p.zoom;
    const c = at(r.x + r.w / 2, r.y + r.h / 2);
    const cx = body.x + c.x;
    const cy = body.y + c.y;
    const S = Math.min((W * 0.9) / (r.w * fullW), (H * 0.6) / (r.h * fullH), 3.2);
    const s = 1 + (S - 1) * zoomT;
    camera = `translate(${(W / 2 - cx * S) * zoomT}px, ${(H / 2 - cy * S) * zoomT}px) scale(${s})`;
  }

  const media = (w: number, h: number, extra: React.CSSProperties = {}) =>
    !asset ? (
      <AbsoluteFill style={{ background: colors.paper, alignItems: "center", justifyContent: "center", fontFamily: fonts.mono, color: colors.muted, fontSize: 28 * k }}>{p.assetId}</AbsoluteFill>
    ) : asset.kind === "video" ? (
      <OffthreadVideo src={asset.url} muted trimBefore={Math.round(p.from * fps)} style={{ width: w, height: h, objectFit: "cover", display: "block", ...extra }} />
    ) : (
      <Img src={asset.url} style={{ width: w, height: h, display: "block", ...extra }} />
    );

  const screenRadius = p.device === "iphone" ? screen.w * 0.14 : p.device === "none" ? 26 * k : 0;
  const shadow = `0 ${50 * k}px ${100 * k}px rgba(24,22,18,0.22), 0 ${14 * k}px ${28 * k}px rgba(24,22,18,0.14)`;

  // Words of the headline enter one by one.
  let wi = 0;
  const words = (text: string, muted: boolean) =>
    text.split("\n").map((l, li) => (
      <div key={`${muted}${li}`} style={{ opacity: muted ? (light ? 0.55 : 0.68) : 1, fontStyle: muted ? "italic" : "normal" }}>
        {l.split(" ").filter(Boolean).map((w) => {
          const t = ramp(frame, 4 + wi++ * STAGGER, ENTER);
          return (
            <span key={wi} style={{ ...blurIn(t, fs), marginRight: "0.24em" }}>
              {w}
            </span>
          );
        })}
      </div>
    ));

  // Focus tools, in body coordinates.
  const hl = p.highlight;
  const loupe = p.loupe;
  const cur = p.cursor;
  let loupeEl: React.ReactNode = null;
  if (loupe) {
    const lt = ramp(frame, loupe.at, 12);
    const R = (loupe.size * screen.w) / 2;
    const c = at(loupe.x, loupe.y);
    const z = loupe.zoom;
    loupeEl = lt > 0 && (
      <div
        style={{
          position: "absolute",
          left: c.x - R,
          top: c.y - R,
          width: R * 2,
          height: R * 2,
          borderRadius: 999,
          overflow: "hidden",
          background: "#fff",
          opacity: lt,
          transform: `scale(${0.7 + 0.3 * lt})`,
          boxShadow: `0 0 0 ${7 * k}px #fff, 0 ${30 * k}px ${60 * k}px rgba(0,0,0,0.3), 0 ${6 * k}px ${14 * k}px rgba(0,0,0,0.18)`,
        }}
      >
        <div style={{ position: "absolute", left: R - loupe.x * fullW * z, top: R - loupe.y * fullH * z, width: fullW * z, height: fullH * z }}>
          {media(fullW * z, fullH * z)}
        </div>
        <div style={{ position: "absolute", inset: 0, borderRadius: 999, boxShadow: `inset 0 0 ${24 * k}px rgba(0,0,0,0.18)` }} />
      </div>
    );
  }
  let cursorEl: React.ReactNode = null;
  // A screen recording with an interaction log: the cursor replays the real clicks and scrolls.
  const recorded = !cur && p.autoCursor && asset?.kind === "video" ? asset.events?.filter((e) => e.x !== undefined && e.y !== undefined) : undefined;
  if (recorded?.length) {
    const keys: PathKey[] = recorded.map((e) => ({
      at: Math.round((e.t - p.from) * fps),
      x: e.x!,
      y: e.y!,
      x2: e.type === "drag" ? e.x2 : undefined,
      y2: e.type === "drag" ? e.y2 : undefined,
      click: e.type === "click",
      label: e.type === "click" ? e.label : undefined,
    }));
    const c = followPath(frame, keys, fps);
    if (c) {
      const pos = at(c.x, c.y);
      const color = colors.accent;
      cursorEl = (
        <>
          {c.ripples.map((r, i) => {
            const rp = at(r.x, r.y);
            return <ClickRipple key={i} x={rp.x} y={rp.y} k={k} color={color} t={r.t} />;
          })}
          <CursorTag x={pos.x} y={pos.y} k={k} color={color} label={c.label} press={c.press} opacity={c.opacity} labelT={c.labelT} />
        </>
      );
    }
  }
  if (cur) {
    const to = at(cur.x, cur.y);
    const from = at(cur.fromX ?? Math.min(1.05, cur.x + 0.3), cur.fromY ?? cur.y + 0.18);
    const pos = glide(frame, from, to, cur.at, cur.moveFrames);
    const clickAt = cur.at + cur.moveFrames + 4;
    const press = cur.click ? interpolate(frame, [clickAt, clickAt + 3, clickAt + 8], [0, 1, 0], clamp) : 0;
    const color = cur.color ?? colors.accent;
    cursorEl = frame >= cur.at - 6 && (
      <>
        {cur.click && <ClickRipple x={to.x} y={to.y} k={k} color={color} t={(frame - clickAt) / (0.7 * fps)} />}
        <CursorTag x={pos.x} y={pos.y} k={k} color={color} label={cur.label} press={press} opacity={ramp(frame, cur.at - 6, 8)} labelT={ramp(frame, cur.at, 10)} />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Backdrop background={p.background} />
        {hasText && (
          <div style={{ position: "absolute", left: textLeft, top: textTop, width: textWidth, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 30 * k, opacity: 1 - zoomT }}>
            {p.label && <Label text={p.label} k={k} t={ramp(frame, 0, ENTER)} dark={!light} />}
            {p.caption && (
              <div style={{ ...serif(500), fontSize: fs, lineHeight: 1.02, letterSpacing: tracking.display, color: ink }}>
                {words(p.caption, false)}
                {p.muted && words(p.muted, true)}
              </div>
            )}
          </div>
        )}
      <AbsoluteFill style={{ transform: camera, transformOrigin: "0 0" }}>
        <AbsoluteFill style={{ perspective: 2600 * k }}>
          <div
            style={{
              position: "absolute",
              left: body.x,
              top: body.y,
              width: body.w,
              height: body.h,
              opacity: interpolate(enter, [0, 0.4], [0, 1], clamp),
              transform: `translateY(${(1 - enter) * H * 0.06 + float}px) rotateX(${tiltT * 8}deg) rotateY(${tiltT * -12}deg) rotateZ(${tiltT * 2}deg)`,
              transformOrigin: "50% 50%",
            }}
          >
            {p.device === "iphone" && (
              <>
                {/* side buttons */}
                {[
                  { side: -1, y: 0.18, h: 0.035 },
                  { side: -1, y: 0.245, h: 0.06 },
                  { side: -1, y: 0.32, h: 0.06 },
                  { side: 1, y: 0.27, h: 0.09 },
                ].map((b, i) => (
                  <div key={i} style={{ position: "absolute", top: body.h * b.y, height: body.h * b.h, width: edge * 2.2, [b.side < 0 ? "left" : "right"]: -edge * 1.4, borderRadius: edge, background: "linear-gradient(90deg, #6d6c69, #a9a8a4, #6d6c69)" }} />
                ))}
                <div style={{ position: "absolute", inset: 0, borderRadius: screenRadius + bezel + edge, background: "linear-gradient(150deg, #a3a29e 0%, #57565a 30%, #8c8b87 60%, #4a4947 100%)", boxShadow: shadow }} />
                <div style={{ position: "absolute", inset: edge, borderRadius: screenRadius + bezel, background: "#060606" }} />
              </>
            )}
            {p.device === "browser" && (
              <div style={{ position: "absolute", inset: 0, borderRadius: 20 * k, background: "#F6F6F4", boxShadow: `${shadow}, 0 0 0 ${1 * k}px rgba(0,0,0,0.06)`, overflow: "hidden" }}>
                <div style={{ height: bar, display: "flex", alignItems: "center", gap: 11 * k, padding: `0 ${22 * k}px` }}>
                  {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                    <div key={c} style={{ width: 15 * k, height: 15 * k, borderRadius: 99, background: c }} />
                  ))}
                  <div style={{ flex: 1, margin: `0 ${80 * k}px 0 ${40 * k}px`, height: 34 * k, borderRadius: 9 * k, background: "#E9E9E6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fonts.sans, fontWeight: 500, fontSize: 19 * k, color: colors.muted, letterSpacing: tracking.text }}>
                    {p.url ?? ""}
                  </div>
                </div>
              </div>
            )}
            {p.device === "none" && <div style={{ position: "absolute", inset: 0, borderRadius: screenRadius, boxShadow: shadow }} />}

            <div style={{ position: "absolute", left: screen.x, top: screen.y, width: screen.w, height: screen.h, borderRadius: p.device === "browser" ? `0 0 ${20 * k}px ${20 * k}px` : screenRadius, overflow: "hidden", background: "#000" }}>
              {media(fullW, fullH, { transform: `translate(${-crop.x * fullW}px, ${-crop.y * fullH - scrollY}px)` })}
              {hl && (
                <div
                  style={{
                    position: "absolute",
                    left: (hl.x - crop.x) * fullW,
                    top: (hl.y - crop.y) * fullH - scrollY,
                    width: hl.w * fullW,
                    height: hl.h * fullH,
                    borderRadius: 18 * k,
                    boxShadow: `0 0 0 ${3000 * k}px rgba(12,12,11,${0.55 * hlT}), 0 0 0 ${4 * k}px rgba(255,255,255,${hlT})`,
                    transform: `scale(${interpolate(hlT, [0, 1], [1.08, 1])})`,
                  }}
                />
              )}
              {p.island && <div style={{ position: "absolute", top: screen.w * 0.03, left: "50%", width: screen.w * 0.3, height: screen.w * 0.085, transform: "translateX(-50%)", borderRadius: 99, background: "#000" }} />}
            </div>
            {loupeEl}
            {cursorEl}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
