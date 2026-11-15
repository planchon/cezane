import type { Anchor, CaptionsClip, Clip, ContentAnchor, MediaClip, Montage, Track } from "./schema";

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}_${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

export const clipEnd = (c: Clip) => c.start + c.duration;

export function montageDuration(m: Montage): number {
  let end = 0;
  for (const t of m.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export function mainTrack(m: Montage): Track | undefined {
  return m.tracks.find((t) => t.role === "main") ?? m.tracks.find((t) => t.kind === "video");
}

export function findTrack(m: Montage, ref: string): Track | undefined {
  return m.tracks.find((t) => t.id === ref) ?? m.tracks.find((t) => t.name.toLowerCase() === ref.toLowerCase());
}

export function findClip(m: Montage, id: string): { track: Track; clip: Clip; index: number } | undefined {
  for (const track of m.tracks) {
    const index = track.clips.findIndex((c) => c.id === id);
    if (index >= 0) return { track, clip: track.clips[index]!, index };
  }
  return undefined;
}

/** Source time (seconds) shown by a media clip at a timeline frame. */
export function srcTimeAt(c: MediaClip, frame: number, fps: number): number {
  return c.srcIn + ((frame - c.start) / fps) * c.speed;
}

/** The clip a comment at `frame` is about: topmost visible media clip, else any clip. */
export function contentAnchorAt(m: Montage, frame: number): ContentAnchor | undefined {
  for (let i = m.tracks.length - 1; i >= 0; i--) {
    const t = m.tracks[i]!;
    if (t.hidden || t.kind === "audio") continue;
    const c = t.clips.find((c) => c.type === "media" && frame >= c.start && frame < clipEnd(c));
    if (c && c.type === "media") {
      return { clipId: c.id, assetId: c.assetId, srcTime: srcTimeAt(c, frame, m.settings.fps) };
    }
  }
  for (const t of m.tracks) {
    const c = t.clips.find((c) => frame >= c.start && frame < clipEnd(c));
    if (c) return { clipId: c.id, clipOffset: frame - c.start };
  }
  return undefined;
}

export type ResolvedAnchor = { frame: number; frameEnd?: number; status: "same" | "moved" | "removed" };

/** Where a montage comment points in another revision of the montage (its content anchor follows the edit). */
export function resolveAnchor(anchor: Anchor, m: Montage): ResolvedAnchor {
  if (anchor.kind !== "montage") return { frame: 0, status: "same" };
  const len = (anchor.frameEnd ?? anchor.frame) - anchor.frame;
  const content = anchor.content;
  if (!content) return { frame: anchor.frame, frameEnd: anchor.frameEnd, status: "same" };
  const hit = findClip(m, content.clipId);
  const fps = m.settings.fps;
  let frame: number | undefined;
  if (hit && hit.clip.type === "media" && content.srcTime !== undefined) {
    const c = hit.clip;
    const f = c.start + Math.round(((content.srcTime - c.srcIn) / c.speed) * fps);
    if (f >= c.start && f < clipEnd(c)) frame = f;
  } else if (hit && content.clipOffset !== undefined) {
    if (content.clipOffset < hit.clip.duration) frame = hit.clip.start + content.clipOffset;
  }
  if (frame === undefined) {
    // The clip was split or trimmed: search every clip of the same asset for that source time.
    if (content.assetId && content.srcTime !== undefined) {
      for (const t of m.tracks)
        for (const c of t.clips) {
          if (c.type !== "media" || c.assetId !== content.assetId) continue;
          const f = c.start + Math.round(((content.srcTime - c.srcIn) / c.speed) * fps);
          if (f >= c.start && f < clipEnd(c)) frame = f;
        }
    }
  }
  if (frame === undefined) return { frame: anchor.frame, frameEnd: anchor.frameEnd, status: "removed" };
  return {
    frame,
    frameEnd: anchor.frameEnd !== undefined ? frame + len : undefined,
    status: frame === anchor.frame ? "same" : "moved",
  };
}

/** Maps a timeline frame through the removal of [s, e). */
export function mapThroughCut(t: number, s: number, e: number): number {
  if (t <= s) return t;
  if (t >= e) return t - (e - s);
  return s;
}

export function shiftCaptionWords(c: CaptionsClip, delta: number): CaptionsClip["words"] {
  return c.words.map((w) => ({ ...w, start: w.start + delta, end: w.end + delta }));
}

export const fmtTime = (frame: number, fps: number) => {
  const s = frame / fps;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};
