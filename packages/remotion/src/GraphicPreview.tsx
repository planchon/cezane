import { AbsoluteFill } from "remotion";
import type { RenderAsset } from "@cezane/core";
import { catalog, isGraphic, parseGraphicProps } from "./catalog";
import { AssetsContext } from "./context";
import { graphics } from "./graphics";
import { Backdrop } from "./ui/Backdrop";

export type GraphicPreviewProps = {
  component: string;
  props: Record<string, unknown>;
  assets?: Record<string, RenderAsset>;
  background?: string;
  width?: number;
  height?: number;
};

/** One catalog component alone, for stills (Claude checks a graphic before using it). */
export const GraphicPreview: React.FC<GraphicPreviewProps> = ({ component, props, assets, background }) => {
  const Comp = graphics[component as keyof typeof graphics];
  const parsed = parseGraphicProps(component, props);
  const duration = isGraphic(component) ? catalog[component].defaultDuration : 60;
  return (
    <AssetsContext.Provider value={assets ?? {}}>
      <AbsoluteFill>
        <Backdrop background={background ?? "night"} drift={false} />
        {Comp && parsed ? <Comp {...parsed} duration={duration} /> : null}
      </AbsoluteFill>
    </AssetsContext.Provider>
  );
};
