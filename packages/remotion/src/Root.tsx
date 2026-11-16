import { Composition } from "remotion";
import { montageDuration, type LookProps, type Montage, type TimelineProps } from "@cezane/core";
import { catalog, isGraphic } from "./catalog";
import { GraphicPreview, type GraphicPreviewProps } from "./GraphicPreview";
import { Look } from "./Look";
import { Timeline } from "./Timeline";

const emptyMontage: Montage = {
  id: "m_preview",
  name: "Preview",
  settings: { width: 1080, height: 1920, fps: 30, background: "#000000" },
  tracks: [],
  audio: { targetLufs: -14, voice: "none", duck: true, duckDb: -12 },
};

const timelineDefaults: TimelineProps = { montage: emptyMontage, assets: {} };
const lookDefaults: LookProps = { montage: emptyMontage, assets: {}, items: [] };
const previewDefaults: GraphicPreviewProps = { component: "Title", props: { text: "Cezane" } };

const size = (m: Montage) => ({ width: m.settings.width, height: m.settings.height, fps: m.settings.fps });

export const Root: React.FC = () => (
  <>
    <Composition
      id="Timeline"
      component={Timeline}
      defaultProps={timelineDefaults}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1}
      calculateMetadata={({ props }) => ({ ...size(props.montage), durationInFrames: Math.max(1, montageDuration(props.montage)) })}
    />
    <Composition
      id="Look"
      component={Look}
      defaultProps={lookDefaults}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1}
      // Frames under <Freeze> are clamped to the composition range: it must reach the last frame looked at.
      calculateMetadata={({ props }) => ({
        ...size(props.montage),
        durationInFrames: Math.max(1, montageDuration(props.montage), ...props.items.map((i) => Math.max(i.frame + 1, i.montage ? montageDuration(i.montage) : 0))),
      })}
    />
    <Composition
      id="GraphicPreview"
      component={GraphicPreview}
      defaultProps={previewDefaults}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={60}
      calculateMetadata={({ props }) => ({
        width: props.width ?? 1080,
        height: props.height ?? 1920,
        durationInFrames: isGraphic(props.component) ? catalog[props.component].defaultDuration : 60,
      })}
    />
  </>
);
