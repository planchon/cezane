import { z } from "zod";
import { CaptionStyle, type GraphicInfo, type SubjectPlacement } from "@cezane/core";
import { backgroundNames, colors } from "./theme";

// The motion-design catalog: names, prop schemas and defaults. No React here, the server imports it.
// Each component lives in src/graphics/<Name>.tsx; that file's hash is the component version.

const RegionSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const Position = z.enum(["top", "center", "bottom"]);

/** Accepts the style names used before the Studio look. */
const legacyEnum = <T extends string>(values: readonly [T, ...T[]], legacy: Record<string, T>) =>
  z.preprocess((v) => (typeof v === "string" && v in legacy ? legacy[v] : v), z.enum(values));

export const TitleSchema = z.object({
  text: z.string().default("Titre").describe("main line(s); \\n for line breaks"),
  muted: z.string().optional().describe("line(s) after the main text in a muted tone (two-tone title)"),
  kicker: z.string().optional().describe("small mono label above"),
  subtitle: z.string().optional().describe("smaller line below"),
  style: legacyEnum(["plain", "native", "ink"], { bold: "plain", elegant: "plain", boxed: "native" })
    .default("plain")
    .describe("plain = white on footage; native = TikTok white blocks (hooks); ink = dark text for light backgrounds"),
  position: Position.default("top"),
  y: z.number().optional().describe("vertical center 0..1, overrides position"),
  align: z.enum(["left", "center"]).optional().describe("default left, center for native"),
  color: z.string().optional(),
  size: z.number().default(104).describe("font size px at 1080 wide"),
  scrim: z.boolean().default(true).describe("soft dark gradient behind (plain style)"),
});

export const TextPopSchema = z.object({
  text: z.string().default("Wow"),
  highlight: z.string().optional().describe("word(s) with a highlighter stroke behind"),
  position: Position.default("center"),
  color: z.string().default(colors.white),
  accent: z.string().default(colors.marker).describe("highlighter color"),
  size: z.number().default(96),
  y: z.number().optional().describe("vertical center 0..1, overrides position"),
});

export const PlateSchema = z.object({
  background: z.string().default("sky").describe(`painted plate or flat background: ${backgroundNames.join("|")}, or any CSS background`),
});

export const BigTextSchema = z.object({
  text: z.string().default("WOW").describe("1–3 short words; \\n for a second line"),
  color: z.string().default(colors.white),
  weight: z.number().int().default(700),
  size: z.number().optional().describe("font size px at 1080 wide (default: fit the width)"),
  position: Position.default("top"),
  y: z.number().optional().describe("vertical center 0..1 (default: placed from the person when behind)"),
});

export const CursorSchema = z.object({
  label: z.string().optional().describe("name tag next to the cursor (\"Cliquez ici\")"),
  x: z.number().default(0.5).describe("target point 0..1 of the frame"),
  y: z.number().default(0.5),
  fromX: z.number().optional().describe("start point 0..1 (default: below right of the target)"),
  fromY: z.number().optional(),
  color: z.string().default(colors.accent),
  click: z.boolean().default(true).describe("click with a ripple when it arrives"),
  moveFrames: z.number().int().default(20),
});

export const HighlightSchema = z.object({
  region: RegionSchema.default({ x: 0.2, y: 0.4, w: 0.6, h: 0.2 }).describe("normalized region kept bright"),
  dim: z.number().default(0.62).describe("darkness outside 0..1"),
  radius: z.number().default(28),
  color: z.string().default(colors.white).describe("ring color"),
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
  color: z.string().default(colors.white),
  accent: z.string().default(colors.white).describe("prefix/suffix color (same as color = muted tone)"),
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
  color: z.string().default(colors.white),
  height: z.number().default(10),
});

export const FlashSchema = z.object({ color: z.string().default("#FFFFFF") });

export const WhipSchema = z.object({
  direction: z.enum(["left", "right", "up", "down"]).default("left"),
  tint: z.string().default("rgba(255,255,255,0.25)"),
});

const Point = { x: z.number().describe("0..1 of the capture"), y: z.number() };

export const ScreenshotShowcaseSchema = z.object({
  assetId: z.string().describe("image or video asset (screenshot / screen recording)"),
  device: z.enum(["iphone", "browser", "none"]).default("iphone"),
  background: z.string().default("sky").describe(`painted plate or flat background: ${backgroundNames.join("|")}, or any CSS background`),
  url: z.string().optional().describe("text in the browser address bar"),
  crop: RegionSchema.optional().describe("part of the capture to show (0..1 of the image); other coordinates stay relative to the full image"),
  label: z.string().optional().describe("small mono label above the headline (\"Dax · Aujourd'hui\")"),
  caption: z.string().optional().describe("headline; \\n for line breaks"),
  muted: z.string().optional().describe("headline continuation in a muted tone"),
  captionPosition: z.enum(["top", "bottom"]).default("top"),
  captionColor: z.string().optional().describe("default: ink on light backgrounds, white on dark"),
  bleed: z.boolean().default(true).describe("portrait with headline: the phone runs off the bottom edge"),
  highlight: RegionSchema.optional().describe("region of the capture kept bright, the rest dims"),
  highlightAt: z.number().int().default(25).describe("frame where the highlight appears"),
  zoom: RegionSchema.optional().describe("region of the capture the camera pushes into"),
  zoomAt: z.number().int().default(30).describe("frame where the zoom starts"),
  loupe: z
    .object({ ...Point, zoom: z.number().default(2.2), size: z.number().default(0.45).describe("diameter, share of the screen width"), at: z.number().int().default(20) })
    .optional()
    .describe("magnifying glass over a detail"),
  cursor: z
    .object({
      ...Point,
      label: z.string().optional(),
      fromX: z.number().optional(),
      fromY: z.number().optional(),
      at: z.number().int().default(18).describe("frame where it starts moving"),
      moveFrames: z.number().int().default(20),
      click: z.boolean().default(true),
      color: z.string().optional(),
    })
    .optional()
    .describe("Figma-style cursor with a name tag gliding to a spot of the capture (where to look / click)"),
  scroll: z.number().default(0).describe("0..1 share of a tall capture scrolled over the clip"),
  from: z.number().default(0).describe("seconds into a screen recording where the clip starts"),
  autoCursor: z.boolean().default(true).describe("screen recordings with an interaction log: a Figma cursor follows the real clicks and scrolls"),
  tilt: z.boolean().default(false).describe("3D angle"),
  float: z.boolean().default(true),
  island: z.boolean().default(false).describe("draw a Dynamic Island (for captures without one)"),
});

export const CaptionsSchema = z.object({
  style: CaptionStyle.default("clean"),
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
  Title: { description: "Title: two-tone headline (text + muted), mono kicker label, native TikTok blocks for hooks", schema: TitleSchema, defaultDuration: 75 },
  TextPop: { description: "Short line, words enter one by one; highlighter behind chosen words", schema: TextPopSchema, defaultDuration: 45 },
  Plate: { description: "Full-frame painted plate (Cézanne texture, blurred, grain) or flat background, for end and chapter cards", schema: PlateSchema, defaultDuration: 90 },
  BigText: {
    description: "Giant word(s) filling the width. With clip behind:true it sits behind the person (auto-placed above the head or behind the chest; stays in front on close-ups)",
    schema: BigTextSchema,
    defaultDuration: 60,
  },
  Cursor: { description: "Figma-style cursor with a name tag gliding to a spot and clicking (where to look / click)", schema: CursorSchema, defaultDuration: 60 },
  Callout: { description: "Old name of Cursor", schema: CursorSchema, defaultDuration: 60, internal: true },
  Highlight: { description: "Dims everything except a region (spotlight on what is below)", schema: HighlightSchema, defaultDuration: 60 },
  Counter: { description: "Animated number counting up, with label", schema: CounterSchema, defaultDuration: 60 },
  Emoji: { description: "Emoji popping in with a wiggle", schema: EmojiSchema, defaultDuration: 30 },
  ProgressBar: { description: "Bar filling over the clip duration", schema: ProgressBarSchema, defaultDuration: 300 },
  Flash: { description: "White flash transition (place on a cut)", schema: FlashSchema, defaultDuration: 8 },
  Whip: { description: "Whip-pan blur sweep transition (place on a cut)", schema: WhipSchema, defaultDuration: 10 },
  ScreenshotShowcase: {
    description: "Screenshot studio for docs/onboarding/help: capture in an iPhone or browser on a painted plate, headline + label, Figma cursor, loupe, highlight, zoom, scroll (portrait or landscape)",
    schema: ScreenshotShowcaseSchema,
    defaultDuration: 120,
    usesAsset: true,
  },
  Captions: { description: "Word-by-word captions (used by captions clips)", schema: CaptionsSchema, defaultDuration: 90, internal: true },
} satisfies Record<string, Entry>;

export type GraphicName = keyof typeof catalog;
export type TitleProps = z.infer<typeof TitleSchema>;
export type TextPopProps = z.infer<typeof TextPopSchema>;
export type CursorProps = z.infer<typeof CursorSchema>;
export type BigTextProps = z.infer<typeof BigTextSchema>;
export type PlateProps = z.infer<typeof PlateSchema>;
export type HighlightProps = z.infer<typeof HighlightSchema>;
export type CounterProps = z.infer<typeof CounterSchema>;
export type EmojiProps = z.infer<typeof EmojiSchema>;
export type ProgressBarProps = z.infer<typeof ProgressBarSchema>;
export type FlashProps = z.infer<typeof FlashSchema>;
export type WhipProps = z.infer<typeof WhipSchema>;
export type ScreenshotShowcaseProps = z.infer<typeof ScreenshotShowcaseSchema>;

/**
 * Every graphic component receives its parsed props, its clip duration in frames and, for clips
 * drawn behind the person, where that person stands.
 */
export type WithDuration<T> = T & { duration: number; subject?: SubjectPlacement };

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
