import { z } from "zod";
import {
  AudioPatch,
  AudioSettings,
  CaptionsClip,
  Clip,
  GraphicClip,
  MediaClip,
  Montage,
  Settings,
  Track,
} from "./schema";
import { clipEnd, findClip, findTrack, mapThroughCut, newId } from "./timeline";

export const ClipInput = z.discriminatedUnion("type", [
  MediaClip.extend({ id: z.string().optional() }),
  GraphicClip.extend({ id: z.string().optional() }),
  CaptionsClip.extend({ id: z.string().optional() }),
]);
export type ClipInput = z.input<typeof ClipInput>;

/** Edit operations on a montage. A batch of ops is validated and recorded as one revision. */
export const Op = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_track"),
    kind: Track.shape.kind,
    name: z.string().optional(),
    role: Track.shape.role,
    index: z.number().int().optional().describe("position from the bottom; default: top"),
    id: z.string().optional(),
  }),
  z.object({ op: z.literal("remove_track"), track: z.string() }),
  z.object({
    op: z.literal("update_track"),
    track: z.string(),
    set: z.object({ name: z.string(), muted: z.boolean(), hidden: z.boolean(), role: Track.shape.role }).partial(),
  }),
  z.object({ op: z.literal("add_clip"), track: z.string().describe("track id or name"), clip: ClipInput }),
  z.object({
    op: z.literal("update_clip"),
    id: z.string(),
    set: z.record(z.string(), z.unknown()).describe("fields to change; `props` is merged for graphics; null removes a field or prop"),
  }),
  z.object({ op: z.literal("move_clip"), id: z.string(), start: z.number().int().optional(), track: z.string().optional() }),
  z.object({
    op: z.literal("trim_clip"),
    id: z.string(),
    start: z.number().int().optional().describe("new timeline start (trims the head)"),
    end: z.number().int().optional().describe("new timeline end (trims the tail)"),
  }),
  z.object({ op: z.literal("split_clip"), id: z.string(), at: z.number().int() }),
  z.object({
    op: z.literal("remove_clip"),
    id: z.string(),
    ripple: z.boolean().default(false).describe("also cut this time range from every track"),
  }),
  z.object({
    op: z.literal("cut_range"),
    start: z.number().int(),
    end: z.number().int(),
  }).describe("remove [start,end) frames from every track and close the gap"),
  z.object({ op: z.literal("insert_gap"), at: z.number().int(), frames: z.number().int().min(1) }),
  z.object({ op: z.literal("set_settings"), set: Settings.partial() }),
  z.object({ op: z.literal("set_audio"), set: AudioPatch }),
]);
export type Op = z.input<typeof Op>;

export class OpError extends Error {}

const fail = (msg: string): never => {
  throw new OpError(msg);
};

/** Splits a clip at a timeline frame strictly inside it. The left part keeps the id. */
export function splitClip(c: Clip, at: number, fps: number): [Clip, Clip] {
  if (at <= c.start || at >= clipEnd(c)) fail(`split point ${at} is outside clip ${c.id}`);
  const leftLen = at - c.start;
  const rightLen = clipEnd(c) - at;
  const id = newId("c");
  if (c.type === "media") {
    const left: MediaClip = { ...c, duration: leftLen, fadeOut: 0 };
    const right: MediaClip = {
      ...c,
      id,
      start: at,
      duration: rightLen,
      srcIn: c.srcIn + (leftLen / fps) * c.speed,
      fadeIn: 0,
      transitionIn: undefined,
    };
    if (c.zoom) {
      const k = leftLen / c.duration;
      const mid = c.zoom.from + (c.zoom.to - c.zoom.from) * k;
      left.zoom = { ...c.zoom, to: mid };
      right.zoom = { ...c.zoom, from: mid };
    }
    return [left, right];
  }
  if (c.type === "captions") {
    return [
      { ...c, duration: leftLen, words: c.words.filter((w) => w.start < leftLen).map((w) => ({ ...w, end: Math.min(w.end, leftLen) })) },
      {
        ...c,
        id,
        start: at,
        duration: rightLen,
        words: c.words
          .filter((w) => w.end > leftLen)
          .map((w) => ({ ...w, start: Math.max(0, w.start - leftLen), end: w.end - leftLen })),
      },
    ];
  }
  return [{ ...c, duration: leftLen }, { ...c, id, start: at, duration: rightLen }];
}

/** Removes [s, e) from one clip; returns the surviving parts (0, 1 or 2 clips). */
function cutClip(c: Clip, s: number, e: number, fps: number): Clip[] {
  const cs = c.start;
  const ce = clipEnd(c);
  const gap = e - s;
  if (ce <= s) return [c];
  if (cs >= e) return [{ ...c, start: cs - gap }];
  if (c.type === "media") {
    const out: Clip[] = [];
    if (cs < s) out.push({ ...c, duration: s - cs, fadeOut: 0 });
    if (ce > e) {
      const skipped = e - cs;
      out.push({
        ...c,
        id: out.length ? newId("c") : c.id,
        start: s,
        duration: ce - e,
        srcIn: c.srcIn + (skipped / fps) * c.speed,
        fadeIn: 0,
        transitionIn: out.length ? undefined : c.transitionIn,
      });
    }
    return out;
  }
  const ns = mapThroughCut(cs, s, e);
  const ne = mapThroughCut(ce, s, e);
  if (ne - ns < 1) return [];
  if (c.type === "captions") {
    // A page break carried by a removed word moves to the next surviving word.
    let pendingBr = false;
    const words: CaptionsClip["words"] = [];
    for (const w of c.words) {
      const nw = { ...w, start: mapThroughCut(cs + w.start, s, e) - ns, end: mapThroughCut(cs + w.end, s, e) - ns };
      if (nw.end <= nw.start) {
        pendingBr ||= Boolean(w.br);
        continue;
      }
      if (pendingBr) nw.br = true;
      pendingBr = false;
      words.push(nw);
    }
    return [{ ...c, start: ns, duration: ne - ns, words }];
  }
  return [{ ...c, start: ns, duration: ne - ns }];
}

function cutRange(m: Montage, s: number, e: number): void {
  if (e <= s) fail(`empty range ${s}-${e}`);
  for (const t of m.tracks) t.clips = t.clips.flatMap((c) => cutClip(c, s, e, m.settings.fps));
}

function trimClip(c: Clip, start: number | undefined, end: number | undefined, fps: number): Clip {
  const ns = start ?? c.start;
  const ne = end ?? clipEnd(c);
  if (ne - ns < 1) fail(`trim of ${c.id} leaves no frames`);
  const headDelta = ns - c.start;
  if (c.type === "media") {
    const srcIn = c.srcIn + (headDelta / fps) * c.speed;
    if (srcIn < 0) fail(`trim of ${c.id} goes before the start of the source`);
    return { ...c, start: ns, duration: ne - ns, srcIn };
  }
  if (c.type === "captions") {
    const words = c.words
      .map((w) => ({ ...w, start: w.start - headDelta, end: w.end - headDelta }))
      .filter((w) => w.end > 0 && w.start < ne - ns);
    return { ...c, start: ns, duration: ne - ns, words };
  }
  return { ...c, start: ns, duration: ne - ns };
}

function sortClips(t: Track) {
  t.clips.sort((a, b) => a.start - b.start);
}

export type ApplyResult = { montage: Montage; summary: string[] };

/**
 * Applies a batch of edit operations. Pure: returns a new montage, never mutates the input.
 * `assetIds`, when given, rejects media clips pointing to unknown assets.
 */
export function applyOps(input: Montage, ops: Op[], opts: { assetIds?: Set<string> } = {}): ApplyResult {
  const m: Montage = structuredClone(input);
  const fps = m.settings.fps;
  const summary: string[] = [];
  const track = (ref: string) => findTrack(m, ref) ?? fail(`unknown track ${ref}`);
  const clip = (id: string) => findClip(m, id) ?? fail(`unknown clip ${id}`);

  for (const raw of ops) {
    const op = Op.parse(raw);
    switch (op.op) {
      case "add_track": {
        const t: Track = {
          id: op.id ?? newId("t"),
          kind: op.kind,
          name: op.name ?? op.role ?? op.kind,
          role: op.role,
          muted: false,
          hidden: false,
          clips: [],
        };
        if (m.tracks.some((x) => x.id === t.id)) fail(`track ${t.id} already exists`);
        m.tracks.splice(op.index ?? m.tracks.length, 0, t);
        summary.push(`added ${t.kind} track ${t.id} "${t.name}"`);
        break;
      }
      case "remove_track": {
        const t = track(op.track);
        m.tracks = m.tracks.filter((x) => x !== t);
        summary.push(`removed track ${t.id}`);
        break;
      }
      case "update_track": {
        Object.assign(track(op.track), op.set);
        summary.push(`updated track ${op.track}`);
        break;
      }
      case "add_clip": {
        const t = track(op.track);
        const c = Clip.parse({ ...op.clip, id: op.clip.id ?? newId("c") });
        if (findClip(m, c.id)) fail(`clip ${c.id} already exists`);
        if (c.type === "media" && opts.assetIds && !opts.assetIds.has(c.assetId)) fail(`unknown asset ${c.assetId}`);
        t.clips.push(c);
        sortClips(t);
        summary.push(`added ${c.type === "graphic" ? c.component : c.type} ${c.id} on ${t.name} ${c.start}–${clipEnd(c)}f`);
        break;
      }
      case "update_clip": {
        const hit = clip(op.id);
        const set = { ...op.set };
        delete set.id;
        delete set.type;
        // Fields (and graphic props) set to null are removed: `{zoom: null}` drops the zoom.
        const merged: Record<string, unknown> = { ...hit.clip, ...set };
        if (hit.clip.type === "graphic" && set.props && typeof set.props === "object")
          merged.props = { ...hit.clip.props, ...(set.props as Record<string, unknown>) };
        for (const obj of [merged, merged.props as Record<string, unknown> | undefined])
          if (obj) for (const k of Object.keys(obj)) if (obj[k] === null) delete obj[k];
        const c = Clip.parse(merged);
        if (c.type === "media" && opts.assetIds && !opts.assetIds.has(c.assetId)) fail(`unknown asset ${c.assetId}`);
        hit.track.clips[hit.index] = c;
        sortClips(hit.track);
        summary.push(`updated ${op.id} (${Object.keys(set).join(", ")})`);
        break;
      }
      case "move_clip": {
        const hit = clip(op.id);
        const c = { ...hit.clip, start: op.start ?? hit.clip.start };
        if (c.start < 0) fail(`negative start for ${op.id}`);
        hit.track.clips.splice(hit.index, 1);
        const dest = op.track ? track(op.track) : hit.track;
        dest.clips.push(c);
        sortClips(dest);
        summary.push(`moved ${op.id} to ${dest.name} @${c.start}f`);
        break;
      }
      case "trim_clip": {
        const hit = clip(op.id);
        hit.track.clips[hit.index] = trimClip(hit.clip, op.start, op.end, fps);
        sortClips(hit.track);
        summary.push(`trimmed ${op.id} to ${op.start ?? hit.clip.start}–${op.end ?? clipEnd(hit.clip)}f`);
        break;
      }
      case "split_clip": {
        const hit = clip(op.id);
        const [a, b] = splitClip(hit.clip, op.at, fps);
        hit.track.clips.splice(hit.index, 1, a, b);
        summary.push(`split ${op.id} at ${op.at}f → ${b.id}`);
        break;
      }
      case "remove_clip": {
        const hit = clip(op.id);
        hit.track.clips.splice(hit.index, 1);
        if (op.ripple) cutRange(m, hit.clip.start, clipEnd(hit.clip));
        summary.push(`removed ${op.id}${op.ripple ? ` and closed ${hit.clip.duration}f` : ""}`);
        break;
      }
      case "cut_range": {
        cutRange(m, op.start, op.end);
        summary.push(`cut ${op.start}–${op.end}f (${((op.end - op.start) / fps).toFixed(2)}s)`);
        break;
      }
      case "insert_gap": {
        for (const t of m.tracks) for (const c of t.clips) if (c.start >= op.at) c.start += op.frames;
        summary.push(`inserted ${op.frames}f at ${op.at}f`);
        break;
      }
      case "set_settings": {
        m.settings = Settings.parse({ ...m.settings, ...op.set });
        summary.push(`settings: ${JSON.stringify(op.set)}`);
        break;
      }
      case "set_audio": {
        m.audio = AudioSettings.parse({ ...m.audio, ...op.set });
        summary.push(`audio: ${JSON.stringify(op.set)}`);
        break;
      }
    }
  }
  const montage = Montage.parse(m);
  const ids = new Set<string>();
  for (const t of montage.tracks)
    for (const c of t.clips) {
      if (ids.has(c.id)) fail(`duplicate clip id ${c.id}`);
      ids.add(c.id);
    }
  return { montage, summary };
}

export function emptyMontage(name = "Montage", settings: Partial<Settings> = {}): Montage {
  return Montage.parse({
    id: newId("m"),
    name,
    settings: Settings.parse(settings),
    tracks: [
      { id: "t_main", kind: "video", name: "Main", role: "main", clips: [] },
      { id: "t_broll", kind: "overlay", name: "B-roll", role: "broll", clips: [] },
      { id: "t_gfx", kind: "overlay", name: "Graphics", role: "graphics", clips: [] },
      { id: "t_caps", kind: "overlay", name: "Captions", role: "captions", clips: [] },
      { id: "t_music", kind: "audio", name: "Music", role: "music", clips: [] },
    ],
  });
}
