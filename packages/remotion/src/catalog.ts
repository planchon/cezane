import { z } from "zod";
import type { GraphicInfo } from "@cezane/core";
import { palette } from "./theme";

// The motion-design catalog: names, prop schemas and defaults. No React here, the server imports it.
// Each component lives in src/graphics/<Name>.tsx; that file's hash is the component version.

const RegionSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const Position = z.enum(["top", "center", "bottom"]);

export const TitleSchema = z.object({
  text: z.string().default("Titre").describe("main line; \\n for line breaks"),
  kicker: z.string().optional().describe("small line above"),
  subtitle: z.string().optional().describe("line below"),
  style: z.enum(["bold", "elegant", "boxed"]).default("bold"),
  position: Position.default("center"),
  color: z.string().default("#FFFFFF"),
  accent: z.string().default(palette.gold),
  size: z.number().default(124).describe("font size px"),
  scrim: z.boolean().default(true).describe("dark gradient behind for readability"),
});

export const TextPopSchema = z.object({
  text: z.string().default("Wow"),
  highlight: z.string().optional().describe("word(s) drawn in the accent color with a painted underline"),
  position: Position.default("center"),
  color: z.string().default("#FFFFFF"),
  accent: z.string().default(palette.gold),
  size: z.number().default(104),
  y: z.number().optional().describe("vertical center 0..1, overrides position"),
});

export const LowerThirdSchema = z.object({
  name: z.string().default("Prénom Nom"),
  title: z.string().optional(),
  side: z.enum(["left", "right"]).default("left"),
  y: z.number().default(0.6).describe("vertical position 0..1 (captions sit at 0.72)"),
  accent: z.string().default(palette.terracotta),
});

export const CalloutSchema = z.object({
  label: z.string().default("Ici"),
  x: z.number().default(0.5).describe("target point 0..1"),
  y: z.number().default(0.5),
  labelX: z.number().optional().describe("label center 0..1 (auto when omitted)"),
  labelY: z.number().optional(),
  color: z.string().default(palette.gold),
});

export const HighlightSchema = z.object({
  region: RegionSchema.default({ x: 0.2, y: 0.4, w: 0.6, h: 0.2 }).describe("normalized region kept bright"),
  dim: z.number().default(0.62).describe("darkness outside 0..1"),
  radius: z.number().default(28),
  color: z.string().default(palette.gold).describe("ring color"),
  pulse: z.boolean().default(true),
});

export const CounterSchema = z.object({
  from: z.number().default(0),
  to: z.number().default(100),
  decimals: z.number().int().default(0),
  prefix: z.string().default(""),
  suffix: z.string().default(""),
  label: z.string().optional(),
  position: Position.default("center"),
  color: z.string().default("#FFFFFF"),
  accent: z.string().default(palette.gold),
});

export const EmojiSchema = z.object({
  emoji: z.string().default("🔥"),
  x: z.number().default(0.5),
  y: z.number().default(0.3),
  size: z.number().default(220),
  wiggle: z.boolean().default(true),
});

export const ProgressBarSchema = z.object({
  position: z.enum(["top", "bottom"]).default("top"),
  color: z.string().default(palette.gold),
  height: z.number().default(12),
});

export const FlashSchema = z.object({ color: z.string().default("#FFFFFF") });

export const WhipSchema = z.object({
  direction: z.enum(["left", "right", "up", "down"]).default("left"),
  tint: z.string().default("rgba(255,255,255,0.25)"),
});

export const ScreenshotShowcaseSchema = z.object({
  assetId: z.string().describe("image or video asset (screenshot / screen recording)"),
  device: z.enum(["iphone", "browser", "none"]).default("iphone"),
  background: z.string().default("cezanne").describe("cezanne|provence|ochre|sage|prussian|terracotta|cream|dark or any CSS background"),
  url: z.string().optional().describe("text in the browser address bar"),
  caption: z.string().optional(),
  captionPosition: z.enum(["top", "bottom"]).default("top"),
  captionColor: z.string().default(palette.ink),
  highlight: RegionSchema.optional().describe("region of the screenshot kept bright, the rest dims"),
  highlightAt: z.number().int().default(25).describe("frame where the highlight appears"),
  zoom: RegionSchema.optional().describe("region of the screenshot to zoom into"),
  zoomAt: z.number().int().default(30).describe("frame where the zoom starts"),
  scroll: z.number().default(0).describe("0..1 share of a tall screenshot scrolled over the clip"),
  tilt: z.boolean().default(true),
  float: z.boolean().default(true),
});

export const CaptionsSchema = z.object({
  style: z.enum(["bold", "karaoke", "minimal", "box"]).default("bold"),
  position: Position.default("bottom"),
  color: z.string().optional(),
});

type Entry = {
  description: string;
  schema: z.ZodObject;
  defaultDuration: number;
  usesAsset?: boolean;
  /** Internal components (used by clip types, not by `graphic` clips). */
  internal?: boolean;
};

export const catalog = {
  Title: { description: "Big animated title with optional kicker and subtitle", schema: TitleSchema, defaultDuration: 75 },
  TextPop: { description: "Short punchy text, words pop one by one; highlight a word", schema: TextPopSchema, defaultDuration: 45 },
  LowerThird: { description: "Name and role banner sliding in", schema: LowerThirdSchema, defaultDuration: 90 },
  Callout: { description: "Label with an animated arrow pointing at a spot", schema: CalloutSchema, defaultDuration: 60 },
  Highlight: { description: "Dims everything except a region (spotlight on what is below)", schema: HighlightSchema, defaultDuration: 60 },
  Counter: { description: "Animated number counting up, with label", schema: CounterSchema, defaultDuration: 60 },
  Emoji: { description: "Emoji popping in with a wiggle", schema: EmojiSchema, defaultDuration: 30 },
  ProgressBar: { description: "Bar filling over the clip duration", schema: ProgressBarSchema, defaultDuration: 300 },
  Flash: { description: "White flash transition (place on a cut)", schema: FlashSchema, defaultDuration: 8 },
  Whip: { description: "Whip-pan blur sweep transition (place on a cut)", schema: WhipSchema, defaultDuration: 10 },
  ScreenshotShowcase: {
    description: "Screenshot studio: app screenshot or screen recording in an iPhone or browser frame on a painted background, with highlight, zoom, scroll, caption",
    schema: ScreenshotShowcaseSchema,
    defaultDuration: 120,
    usesAsset: true,
  },
  Captions: { description: "Word-by-word captions (used by captions clips)", schema: CaptionsSchema, defaultDuration: 90, internal: true },
} satisfies Record<string, Entry>;

export type GraphicName = keyof typeof catalog;
export type TitleProps = z.infer<typeof TitleSchema>;
export type TextPopProps = z.infer<typeof TextPopSchema>;
export type LowerThirdProps = z.infer<typeof LowerThirdSchema>;
export type CalloutProps = z.infer<typeof CalloutSchema>;
export type HighlightProps = z.infer<typeof HighlightSchema>;
export type CounterProps = z.infer<typeof CounterSchema>;
export type EmojiProps = z.infer<typeof EmojiSchema>;
export type ProgressBarProps = z.infer<typeof ProgressBarSchema>;
export type FlashProps = z.infer<typeof FlashSchema>;
export type WhipProps = z.infer<typeof WhipSchema>;
export type ScreenshotShowcaseProps = z.infer<typeof ScreenshotShowcaseSchema>;

/** Every graphic component receives its parsed props plus its clip duration in frames. */
export type WithDuration<T> = T & { duration: number };

export const isGraphic = (name: string): name is GraphicName => Object.hasOwn(catalog, name);

/** Parses props with the component's schema (defaults applied). Returns null when they are invalid. */
export function parseGraphicProps(name: string, props: unknown): Record<string, unknown> | null {
  if (!isGraphic(name)) return null;
  const r = catalog[name].schema.safeParse(props ?? {});
  return r.success ? (r.data as Record<string, unknown>) : null;
}

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  description?: string;
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
};

function describeProp(s: JsonSchema, required: boolean): string {
  const inner = s.anyOf?.find((x) => x.type !== "null") ?? s;
  let type = inner.enum ? inner.enum.map(String).join("|") : Array.isArray(inner.type) ? inner.type.join("|") : (inner.type ?? "any");
  if (type === "object" && inner.properties) type = `{${Object.keys(inner.properties).join(",")}}`;
  const parts = [type];
  if (s.default !== undefined) parts.push(`=${JSON.stringify(s.default)}`);
  else if (!required) parts.push("optional");
  if (s.description) parts.push(`— ${s.description}`);
  return parts.join(" ");
}

/** Compact catalog for Claude and the UI. */
export function graphicInfos(): GraphicInfo[] {
  return Object.entries(catalog)
    .filter(([, e]) => !("internal" in e && e.internal))
    .map(([name, e]) => {
      const js = z.toJSONSchema(e.schema, { io: "input" }) as JsonSchema & { required?: string[] };
      const props: Record<string, string> = {};
      for (const [k, v] of Object.entries(js.properties ?? {})) props[k] = describeProp(v, js.required?.includes(k) ?? false);
      return { name, description: e.description, props, defaultDuration: e.defaultDuration };
    });
}
