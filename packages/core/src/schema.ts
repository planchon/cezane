import { z } from "zod";

/** Normalized rectangle on a frame (0..1 on both axes, origin top-left). */
export const Region = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Region = z.infer<typeof Region>;

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

/**
 * Color grade: a 3D LUT (.cube) by name — built-in (drame, film, provence, nuit, pastel, noir),
 * a file in the project's luts/ folder or in ~/Cezane/luts — or "none". Applied to footage only,
 * never to graphics or text.
 */
export const Grade = z.object({
  lut: z.string(),
  intensity: z.number().min(0).max(1).default(1),
  vignette: z.number().min(0).max(1).default(0),
});
export type Grade = z.infer<typeof Grade>;

export const Settings = z.object({
  width: z.number().int().default(1080),
  height: z.number().int().default(1920),
  fps: z.number().int().default(30),
  background: z.string().default("#000000"),
  grade: Grade.optional(), // look of every imported footage clip (captures and generated images stay as they are)
});
export type Settings = z.infer<typeof Settings>;

// ───────────────────────── Assets ─────────────────────────

export const Provenance = z.discriminatedUnion("type", [
  z.object({ type: z.literal("import"), path: z.string() }),
  z.object({
    type: z.literal("generated"),
    provider: z.string(),
    model: z.string(),
    prompt: z.string(),
    inputs: z.array(z.string()).default([]),
    settings: z.record(z.string(), z.unknown()).default({}),
    cost: z.number().optional(),
    seed: z.number().optional(),
  }),
  z.object({
    type: z.literal("capture"),
    source: z.enum(["web", "ios", "finder"]), // finder: a file dropped into Captures/ by hand
    target: z.string(),
    note: z.string().optional(),
  }),
]);
export type Provenance = z.infer<typeof Provenance>;

/** Files computed once per source, stored in the global cache dir of the asset hash. */
export const Derived = z.object({
  normalized: z.string().optional(), // H.264 CFR mp4 (video) or png (image)
  audio: z.string().optional(), // wav 48k
  cleanAudio: z.string().optional(), // denoised voice wav
  transcript: z.string().optional(), // transcript.json (Transcript)
  analysis: z.string().optional(), // analysis.json (Analysis)
  thumbs: z.string().optional(), // sprite jpg: 10 thumbs in a row
  poster: z.string().optional(), // poster jpg
  waveform: z.string().optional(), // waveform.json (number[] peaks 0..1)
  cutout: z.string().optional(), // webm vp9 with alpha (person cutout)
  subject: z.string().optional(), // subject.json: per-frame silhouette box and face (SubjectTrack)
  graded: z.record(z.string(), z.object({ file: z.string(), cutout: z.string().optional() })).optional(), // gradeFileKey → graded copies
  events: z.string().optional(), // events.json of a screen recording: clicks, typing, scrolls (CaptureEvent[])
});
export type Derived = z.infer<typeof Derived>;

export const Asset = z.object({
  id: z.string(),
  kind: z.enum(["video", "image", "audio"]),
  name: z.string(),
  hash: z.string(),
  file: z.string(), // original file, relative to the project dir: Rushes/…, Générés/…, Captures/… (media/<hash>.<ext> before v0.2)
  duration: z.number().optional(), // seconds
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.number().optional(),
  hasAudio: z.boolean().default(false),
  provenance: Provenance,
  derived: Derived.default({}),
  status: z.enum(["ingesting", "ready", "error"]).default("ingesting"),
  error: z.string().optional(),
  missing: z.boolean().optional(), // its file was deleted from the Finder; renders still work from the cache
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof Asset>;

export const Word = z.object({ text: z.string(), start: z.number(), end: z.number() }); // seconds
export type Word = z.infer<typeof Word>;
export const Transcript = z.object({ language: z.string(), words: z.array(Word) });
export type Transcript = z.infer<typeof Transcript>;

export const Analysis = z.object({
  silences: z.array(z.object({ start: z.number(), end: z.number() })), // seconds
  scenes: z.array(z.number()), // scene-change times (seconds)
  loudness: z.number().optional(), // integrated LUFS
});
export type Analysis = z.infer<typeof Analysis>;

// ───────────────────────── Montage ─────────────────────────

const ClipBase = {
  id: z.string(),
  start: z.number().int().min(0), // timeline frame
  duration: z.number().int().min(1), // frames
  label: z.string().optional(),
};

export const Zoom = z.object({
  from: z.number().default(1),
  to: z.number().default(1.15),
  x: z.number().default(0.5), // focus point, normalized on the source frame
  y: z.number().default(0.5),
  easing: z.enum(["linear", "ease", "punch"]).default("ease"),
});
export type Zoom = z.infer<typeof Zoom>;

export const Transition = z.object({
  type: z.enum(["fade", "whip", "zoom", "slide"]),
  frames: z.number().int().min(1).default(8),
});

export const MediaClip = z.object({
  ...ClipBase,
  type: z.literal("media"),
  assetId: z.string(),
  srcIn: z.number().min(0).default(0), // seconds into the source
  speed: z.number().positive().default(1),
  volume: z.number().min(0).default(1), // linear gain of the clip audio
  muted: z.boolean().default(false),
  fadeIn: z.number().int().min(0).default(0), // audio fade, frames
  fadeOut: z.number().int().min(0).default(0),
  fit: z.enum(["cover", "contain"]).default("cover"),
  focus: Point.default({ x: 0.5, y: 0.5 }), // what stays in frame when cover-cropping
  zoom: Zoom.optional(),
  cutout: z.boolean().default(false), // show the person cutout (transparent background) instead of the full frame
  box: Region.optional(), // where the clip is drawn (0..1 of the frame); default the whole frame. Green screen: cutout + box at the bottom
  outline: z.object({ width: z.number().default(10), color: z.string().default("#FFFFFF") }).optional(), // sticker edge around a cutout, px at 1080 wide
  grade: Grade.optional(), // overrides the montage grade for this clip ({lut:"none"} to keep it raw)
  opacity: z.number().min(0).max(1).default(1),
  transitionIn: Transition.optional(),
  canvasRef: z.object({ canvasId: z.string(), shapeId: z.string() }).optional(),
});
export type MediaClip = z.infer<typeof MediaClip>;

export const GraphicClip = z.object({
  ...ClipBase,
  type: z.literal("graphic"),
  component: z.string(), // name in the motion-design catalog
  props: z.record(z.string(), z.unknown()).default({}),
  behind: z.boolean().optional(), // drawn behind the person of the main track (their cutout goes on top)
});
export type GraphicClip = z.infer<typeof GraphicClip>;

export const CaptionWord = z.object({
  text: z.string(),
  start: z.number().int(), // frames, relative to the clip start
  end: z.number().int(),
  br: z.boolean().optional(), // starts a new caption page (line shown on screen)
});
export type CaptionWord = z.infer<typeof CaptionWord>;

/**
 * Caption looks. clean = serif, the whole page shown, words go from 40% to white as they are said
 * (default); native = TikTok Sans
 * white with a black stroke; pill = active word on a pill; box = page on a box; caps = the
 * all-caps yellow-word look, opt-in only.
 */
export const CAPTION_STYLES = ["clean", "native", "pill", "box", "caps"] as const;
const legacyCaptionStyle: Record<string, (typeof CAPTION_STYLES)[number]> = { bold: "clean", karaoke: "pill", minimal: "clean" };
export const CaptionStyle = z.preprocess((v) => (typeof v === "string" && v in legacyCaptionStyle ? legacyCaptionStyle[v] : v), z.enum(CAPTION_STYLES));
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const CaptionsClip = z.object({
  ...ClipBase,
  type: z.literal("captions"),
  style: CaptionStyle.default("clean"),
  position: z.enum(["top", "center", "bottom"]).default("bottom"),
  y: z.number().optional(), // vertical center 0..1, overrides position
  color: z.string().optional(), // pill / box / caps accent
  words: z.array(CaptionWord),
});
export type CaptionsClip = z.infer<typeof CaptionsClip>;

export const Clip = z.discriminatedUnion("type", [MediaClip, GraphicClip, CaptionsClip]);
export type Clip = z.infer<typeof Clip>;

export const Track = z.object({
  id: z.string(),
  kind: z.enum(["video", "overlay", "audio"]),
  name: z.string(),
  role: z.enum(["main", "broll", "graphics", "captions", "voice", "music", "sfx"]).optional(),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  clips: z.array(Clip),
});
export type Track = z.infer<typeof Track>;

/**
 * How the music sits under the voice.
 * - bed (default): constant level, `bedDb` under the voice loudness (measured), never silent.
 * - sidechain: compressor keyed by the voice, pulled down by up to `duckDb` while the voice speaks (opt-in, pumps).
 * - false: the music plays at its clip volumes, untouched.
 * Project files written before v0.2 hold a boolean: `true` (the old default) now reads as "bed".
 * `true` stays in the type so hand-written montage literals keep compiling; `musicMode()` reads it as "bed".
 */
export const MUSIC_MODES = ["bed", "sidechain"] as const;
export type MusicMode = (typeof MUSIC_MODES)[number] | "off";
export const Duck = z.preprocess((v) => (v === true ? "bed" : v), z.union([z.enum(MUSIC_MODES), z.boolean()]));
export const BED_DB = 15; // music bed under the voice, dB (measured on the reference creator's reels)

export const VoicePreset = z.enum(["none", "clean", "podcast"]);

export const AudioSettings = z.object({
  targetLufs: z.number().default(-14),
  voice: VoicePreset.default("none"),
  duck: Duck.default("bed"),
  duckDb: z.number().default(-12), // sidechain mode: max gain reduction of the music
  bedDb: z.number().optional(), // bed mode: dB of music under the voice (default BED_DB)
});
export type AudioSettings = z.infer<typeof AudioSettings>;
/** set_audio patch: the same fields without defaults, so changing one keeps the others. */
export const AudioPatch = z.object({ targetLufs: z.number(), voice: VoicePreset, duck: Duck, duckDb: z.number(), bedDb: z.number() }).partial();

export const musicMode = (a: Pick<AudioSettings, "duck">): MusicMode => (a.duck === true ? "bed" : a.duck === false ? "off" : a.duck);

/** Tracks stack bottom → top. The first `video` track is the main track (segments follow its shots). */
export const Montage = z.object({
  id: z.string(),
  name: z.string(),
  settings: Settings,
  tracks: z.array(Track),
  audio: AudioSettings.default({ targetLufs: -14, voice: "none", duck: "bed", duckDb: -12 }),
});
export type Montage = z.infer<typeof Montage>;

// ───────────────────────── Comments & versions ─────────────────────────

export const ContentAnchor = z.object({
  clipId: z.string(),
  assetId: z.string().optional(),
  srcTime: z.number().optional(), // seconds into the source under the comment
  clipOffset: z.number().int().optional(), // frames from the clip start (graphics, captions)
});
export type ContentAnchor = z.infer<typeof ContentAnchor>;

export const Anchor = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("montage"),
    montageId: z.string(),
    versionId: z.string(), // version the user was watching
    frame: z.number().int(),
    frameEnd: z.number().int().optional(), // range comment
    pin: Point.optional(),
    region: Region.optional(),
    content: ContentAnchor.optional(),
  }),
  z.object({
    kind: z.literal("canvas"),
    canvasId: z.string(),
    shapeId: z.string().optional(),
    pin: Point.optional(), // canvas page coordinates
    region: Region.optional(), // normalized on the shape
  }),
]);
export type Anchor = z.infer<typeof Anchor>;

export const CommentStatus = z.enum(["draft", "sent", "in_progress", "fixed", "validated", "reopened"]);
export type CommentStatus = z.infer<typeof CommentStatus>;

export const Message = z.object({
  author: z.enum(["user", "claude"]),
  text: z.string(),
  at: z.string(),
  versionId: z.string().optional(),
});
export type Message = z.infer<typeof Message>;

export const Comment = z.object({
  id: z.string(),
  n: z.number().int(), // display number (#1, #2…)
  status: CommentStatus,
  anchor: Anchor,
  thread: z.array(Message),
  snapshot: z.string().optional(), // project-relative jpg of what the user saw
  fixedIn: z.string().optional(), // version id
  createdAt: z.string(),
});
export type Comment = z.infer<typeof Comment>;

export const FrameRange = z.object({ start: z.number().int(), end: z.number().int() });
export type FrameRange = z.infer<typeof FrameRange>;

/**
 * Why a render failed, classified by the server (deterministic, no AI):
 * - missing: a file the reel uses is gone (deleted or moved in the Finder) and its cache too: `assetIds`;
 * - interrupted: the app or the server closed during the render;
 * - technical: anything else (ffmpeg, Remotion…); `transient` when the error looks like it may pass on a retry.
 */
export const RenderFailure = z.object({
  kind: z.enum(["missing", "interrupted", "technical"]),
  message: z.string(),
  assetIds: z.array(z.string()).optional(),
  logTail: z.string().optional(), // last lines of .cezane/renders/<versionId>.log
  transient: z.boolean().optional(),
});
export type RenderFailure = z.infer<typeof RenderFailure>;

export const Version = z.object({
  id: z.string(), // "v1"
  n: z.number().int(),
  montageId: z.string(),
  revision: z.number().int(),
  author: z.enum(["claude", "user"]),
  summary: z.string(),
  status: z.enum(["rendering", "ready", "error"]),
  progress: z.number().default(0),
  error: z.string().optional(), // short message (same as failure.message)
  failure: RenderFailure.optional(), // status "error": why, and what can fix it
  file: z.string().optional(), // project-relative mp4 (.cezane/renders/vN.mp4)
  exportFile: z.string().optional(), // the same render in Exports/ (`<reel-slug>-vN.mp4`, hard link)
  poster: z.string().optional(),
  montageFile: z.string(), // frozen montage json
  durationFrames: z.number().int(),
  fps: z.number().int(),
  changed: z.array(FrameRange).default([]), // re-rendered passages vs the previous version
  comments: z.array(z.string()).default([]), // comments handled in this version
  segmentKeys: z.array(z.string()).default([]),
  renderSeconds: z.number().optional(),
  createdAt: z.string(),
});
export type Version = z.infer<typeof Version>;

// ───────────────────────── Project ─────────────────────────

export const DocRef = z.object({ id: z.string(), name: z.string() });

export const Project = z.object({
  name: z.string(),
  createdAt: z.string(),
  settings: z
    .object({
      claudeModel: z.string().default("sonnet"),
      budgetEur: z.number().default(5),
      spentEur: z.number().default(0),
    })
    .default({ claudeModel: "sonnet", budgetEur: 5, spentEur: 0 }),
  assets: z.array(Asset).default([]),
  montages: z.array(DocRef).default([]),
  canvases: z.array(DocRef).default([]),
});
export type Project = z.infer<typeof Project>;

/** A canvas document: the tldraw store snapshot, owned by the server. */
export const CanvasDoc = z.object({
  id: z.string(),
  name: z.string(),
  snapshot: z.unknown().optional(),
  /** Shapes added by the server (Claude) as partial tldraw shapes, until the UI materializes them. */
  pending: z.array(z.record(z.string(), z.unknown())).default([]),
  updatedAt: z.string(),
});
export type CanvasDoc = z.infer<typeof CanvasDoc>;
