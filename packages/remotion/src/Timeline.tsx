import { Fragment } from "react";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, useCurrentFrame } from "remotion";
import {
  type CaptionsClip,
  captionRaises,
  clipEnd,
  effectiveGrade,
  gradeFileKey,
  screenRanges,
  type GraphicClip,
  mainClipsIn,
  type MediaClip,
  mediaLayout,
  type Montage,
  type RenderAsset,
  subjectPlacement,
  type SubjectPlacement,
  type TimelineProps,
} from "@cezane/core";
import { parseGraphicProps } from "./catalog";
import { AssetsContext } from "./context";
import { Captions } from "./graphics/Captions";
import { graphics } from "./graphics";
import { clamp } from "./ui/anim";

const MediaClipView: React.FC<{ clip: MediaClip; asset: RenderAsset; montage: Montage; forceCutout?: boolean; window?: [number, number] }> = ({
  clip,
  asset,
  montage,
  forceCutout,
  window,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = montage.settings;
  if (window && (frame < window[0] || frame >= window[1])) return null;
  const nw = asset.width ?? W;
  const nh = asset.height ?? H;
  const L = mediaLayout(clip, nw, nh, W, H);
  const { left, top, width: rw, height: rh } = L;

  let z = 1;
  let origin = "50% 50%";
  if (clip.zoom) {
    const zm = clip.zoom;
    const t = Math.min(1, frame / Math.max(1, clip.duration - 1));
    const e =
      zm.easing === "linear"
        ? t
        : zm.easing === "ease"
          ? Easing.inOut(Easing.cubic)(t)
          : spring({ frame, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });
    z = zm.from + (zm.to - zm.from) * e;
    origin = `${zm.x * rw}px ${zm.y * rh}px`;
  }

  let wrapper: React.CSSProperties = { opacity: clip.opacity };
  const tr = clip.transitionIn;
  if (tr && frame < tr.frames) {
    const t = interpolate(frame, [0, tr.frames], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    if (tr.type === "fade") wrapper = { opacity: clip.opacity * t };
    else if (tr.type === "slide") wrapper = { opacity: clip.opacity, transform: `translateY(${(1 - t) * H}px)` };
    else if (tr.type === "zoom") wrapper = { opacity: clip.opacity * t, transform: `scale(${1.25 - 0.25 * t})` };
    else wrapper = { opacity: clip.opacity, transform: `translateX(${(1 - t) * W}px)`, filter: `blur(${(1 - t) * 24}px)` };
  }

  // Graded copies (LUT) when the clip has a grade; the vignette is drawn over the footage only.
  const grade = effectiveGrade(clip, montage.settings, Boolean(asset.footage));
  const graded = grade ? asset.graded?.[gradeFileKey(grade)] : undefined;
  const src = graded?.url ?? asset.url;
  const cutoutSrc = graded?.cutoutUrl ?? asset.cutoutUrl;
  const cutout = (clip.cutout || forceCutout) && cutoutSrc;
  const k = W / 1080;
  const ow = (clip.outline?.width ?? 0) * k;
  const oc = clip.outline?.color ?? "#fff";
  const filter =
    cutout && clip.outline
      ? [`${ow}px 0`, `-${ow}px 0`, `0 ${ow}px`, `0 -${ow}px`, `${ow * 0.7}px ${ow * 0.7}px`, `-${ow * 0.7}px ${ow * 0.7}px`, `${ow * 0.7}px -${ow * 0.7}px`, `-${ow * 0.7}px -${ow * 0.7}px`]
          .map((d) => `drop-shadow(${d} 0 ${oc})`)
          .concat(`drop-shadow(0 ${14 * k}px ${24 * k}px rgba(0,0,0,0.3))`)
          .join(" ")
      : undefined;
  const style: React.CSSProperties = { position: "absolute", left, top, width: rw, height: rh, transform: `scale(${z})`, transformOrigin: origin, filter };
  // A boxed clip without cutout is a picture-in-picture: clip it to its box.
  const clipBox = clip.box && !cutout ? { left: L.box.x, top: L.box.y, width: L.box.w, height: L.box.h } : null;
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...wrapper, ...(clipBox ? { clipPath: `inset(${clipBox.top}px ${W - clipBox.left - clipBox.width}px ${H - clipBox.top - clipBox.height}px ${clipBox.left}px round ${24 * k}px)` } : {}) }}>
      {asset.kind === "image" ? (
        <Img src={src} style={style} />
      ) : (
        <OffthreadVideo
          src={cutout ? cutoutSrc! : src}
          transparent={Boolean(cutout)}
          trimBefore={Math.round(clip.srcIn * fps)}
          playbackRate={clip.speed}
          muted
          style={style}
        />
      )}
      {grade && grade.vignette > 0 && !cutout && !clip.box && (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 75% 65% at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,${(0.75 * grade.vignette).toFixed(3)}) 100%)` }} />
      )}
    </AbsoluteFill>
  );
};

const GraphicClipView: React.FC<{ clip: GraphicClip; subject?: SubjectPlacement }> = ({ clip, subject }) => {
  const Comp = graphics[clip.component as keyof typeof graphics];
  const props = parseGraphicProps(clip.component, clip.props);
  if (!Comp || !props) return null;
  return <Comp {...props} duration={clip.duration} subject={subject} />;
};

/** Where the person of the main track stands under a `behind` graphic (first main clip it overlaps). */
function behindPlacement(m: Montage, assets: Record<string, RenderAsset>, g: GraphicClip): SubjectPlacement | undefined {
  const mc = mainClipsIn(m, g.start, clipEnd(g))[0];
  const a = mc && assets[mc.assetId];
  if (!mc || !a?.subject || !a.width || !a.height) return undefined;
  return subjectPlacement(a.subject, mc, Math.max(g.start, mc.start), Math.min(clipEnd(g), clipEnd(mc)), { width: a.width, height: a.height }, m.settings);
}

/** The person of the main track, cut out, drawn over a `behind` graphic while it shows. */
const BehindCutouts: React.FC<{ montage: Montage; assets: Record<string, RenderAsset>; g: GraphicClip }> = ({ montage, assets, g }) => (
  <>
    {mainClipsIn(montage, g.start, clipEnd(g)).map((mc) => {
      const a = assets[mc.assetId];
      if (!a?.cutoutUrl || a.kind !== "video") return null;
      const from = Math.max(g.start, mc.start) - mc.start;
      const to = Math.min(clipEnd(g), clipEnd(mc)) - mc.start;
      return (
        <Sequence key={`behind-${g.id}-${mc.id}`} from={mc.start} durationInFrames={mc.duration} name={`cutout ${mc.label ?? mc.id}`}>
          <MediaClipView clip={{ ...mc, transitionIn: undefined }} asset={a} montage={montage} forceCutout window={[from, to]} />
        </Sequence>
      );
    })}
  </>
);

const CaptionsClipView: React.FC<{ clip: CaptionsClip; montage: Montage }> = ({ clip, montage }) => (
  <Captions
    words={clip.words}
    style={clip.style}
    position={clip.position}
    y={clip.y}
    color={clip.color}
    duration={clip.duration}
    raises={captionRaises(montage).map((r) => ({ ...r, start: r.start - clip.start, end: r.end - clip.start }))}
    screens={screenRanges(montage).map((r) => ({ start: r.start - clip.start, end: r.end - clip.start }))}
  />
);

/** Draws a montage at the current frame: tracks bottom → top, always silent (ffmpeg mixes the sound). */
export const TimelineView: React.FC<TimelineProps> = ({ montage, assets }) => (
  <AssetsContext.Provider value={assets}>
    <AbsoluteFill style={{ background: montage.settings.background, overflow: "hidden" }}>
      {montage.tracks.map((track) =>
        track.hidden || track.kind === "audio"
          ? null
          : track.clips.map((clip) => {
              let body: React.ReactNode = null;
              if (clip.type === "media") {
                const asset = assets[clip.assetId];
                if (asset && asset.kind !== "audio") body = <MediaClipView clip={clip} asset={asset} montage={montage} />;
              } else if (clip.type === "graphic") {
                const subject = clip.behind ? behindPlacement(montage, assets, clip) : undefined;
                body = <GraphicClipView clip={clip} subject={subject} />;
                // Text behind a person only reads with headroom and no close-up; otherwise it stays in front.
                if (clip.behind && subject?.usable)
                  return (
                    <Fragment key={clip.id}>
                      <Sequence from={clip.start} durationInFrames={clip.duration} name={clip.label ?? clip.id}>
                        {body}
                      </Sequence>
                      <BehindCutouts montage={montage} assets={assets} g={clip} />
                    </Fragment>
                  );
              } else body = <CaptionsClipView clip={clip} montage={montage} />;
              return body ? (
                <Sequence key={clip.id} from={clip.start} durationInFrames={clip.duration} name={clip.label ?? clip.id}>
                  {body}
                </Sequence>
              ) : null;
            }),
      )}
    </AbsoluteFill>
  </AssetsContext.Provider>
);

export const Timeline: React.FC<TimelineProps> = (props) => <TimelineView {...props} />;
