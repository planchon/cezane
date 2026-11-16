import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, useCurrentFrame } from "remotion";
import type { CaptionsClip, GraphicClip, MediaClip, Montage, RenderAsset, TimelineProps } from "@cezane/core";
import { parseGraphicProps } from "./catalog";
import { AssetsContext } from "./context";
import { Captions } from "./graphics/Captions";
import { graphics } from "./graphics";
import { clamp } from "./ui/anim";

const MediaClipView: React.FC<{ clip: MediaClip; asset: RenderAsset; montage: Montage }> = ({ clip, asset, montage }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = montage.settings;
  const nw = asset.width ?? W;
  const nh = asset.height ?? H;
  const s = clip.fit === "cover" ? Math.max(W / nw, H / nh) : Math.min(W / nw, H / nh);
  const rw = nw * s;
  const rh = nh * s;
  const left = clip.fit === "cover" ? -(rw - W) * clip.focus.x : (W - rw) / 2;
  const top = clip.fit === "cover" ? -(rh - H) * clip.focus.y : (H - rh) / 2;

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

  const style: React.CSSProperties = { position: "absolute", left, top, width: rw, height: rh, transform: `scale(${z})`, transformOrigin: origin };
  const cutout = clip.cutout && asset.cutoutUrl;
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...wrapper }}>
      {asset.kind === "image" ? (
        <Img src={asset.url} style={style} />
      ) : (
        <OffthreadVideo
          src={cutout ? asset.cutoutUrl! : asset.url}
          transparent={Boolean(cutout)}
          trimBefore={Math.round(clip.srcIn * fps)}
          playbackRate={clip.speed}
          muted
          style={style}
        />
      )}
    </AbsoluteFill>
  );
};

const GraphicClipView: React.FC<{ clip: GraphicClip }> = ({ clip }) => {
  const Comp = graphics[clip.component as keyof typeof graphics];
  const props = parseGraphicProps(clip.component, clip.props);
  if (!Comp || !props) return null;
  return <Comp {...props} duration={clip.duration} />;
};

const CaptionsClipView: React.FC<{ clip: CaptionsClip }> = ({ clip }) => (
  <Captions words={clip.words} style={clip.style} position={clip.position} color={clip.color} duration={clip.duration} />
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
              } else if (clip.type === "graphic") body = <GraphicClipView clip={clip} />;
              else body = <CaptionsClipView clip={clip} />;
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
