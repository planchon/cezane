import type { SubjectTrack } from "./api";
import type { MediaClip, Montage } from "./schema";
import { clipEnd, mainTrack } from "./timeline";

/** Where a media clip is drawn, in frame px. Shared by the renderer and the placement helpers. */
export function mediaLayout(clip: Pick<MediaClip, "fit" | "focus" | "box">, nw: number, nh: number, W: number, H: number) {
  const b = clip.box ?? { x: 0, y: 0, w: 1, h: 1 };
  const tx = b.x * W;
  const ty = b.y * H;
  const tw = b.w * W;
  const th = b.h * H;
  const s = clip.fit === "cover" ? Math.max(tw / nw, th / nh) : Math.min(tw / nw, th / nh);
  const rw = nw * s;
  const rh = nh * s;
  const left = tx + (clip.fit === "cover" ? -(rw - tw) * clip.focus.x : (tw - rw) / 2);
  const top = ty + (clip.fit === "cover" ? -(rh - th) * clip.focus.y : (th - rh) / 2);
  return { box: { x: tx, y: ty, w: tw, h: th }, left, top, width: rw, height: rh };
}

/** Media clips of the main track overlapping [start, end). */
export function mainClipsIn(m: Montage, start: number, end: number): MediaClip[] {
  const t = mainTrack(m);
  if (!t) return [];
  return t.clips.filter((c): c is MediaClip => c.type === "media" && c.start < end && clipEnd(c) > start);
}

/** Assets whose person cutout the montage needs: cutout clips, and the main track under `behind` graphics. */
export function cutoutAssets(m: Montage): Set<string> {
  const ids = new Set<string>();
  for (const t of m.tracks)
    for (const c of t.clips) {
      if (c.type === "media" && c.cutout) ids.add(c.assetId);
      if (c.type === "graphic" && c.behind) for (const mc of mainClipsIn(m, c.start, clipEnd(c))) ids.add(mc.assetId);
    }
  return ids;
}

/** Where the person stands during a window, in frame coordinates (0..1). */
export type SubjectPlacement = {
  headTop: number;
  faceTop: number;
  faceBottom: number;
  faceCx: number;
  bodyLeft: number;
  bodyRight: number;
  /** The head fills more than ~35% of the frame height: text behind it would mostly disappear. */
  closeUp: boolean;
  /** Text can go behind: not a close-up, and room above the head for the top of the letters. */
  usable: boolean;
};

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * Median position of the person while a clip plays between timeline frames [from, to),
 * mapped through the clip's crop. Undefined when no face is found.
 */
export function subjectPlacement(
  track: SubjectTrack,
  clip: Pick<MediaClip, "start" | "srcIn" | "speed" | "fit" | "focus" | "box">,
  from: number,
  to: number,
  asset: { width: number; height: number },
  frame: { width: number; height: number; fps: number },
): SubjectPlacement | undefined {
  const t0 = clip.srcIn + ((from - clip.start) / frame.fps) * clip.speed;
  const t1 = clip.srcIn + ((to - clip.start) / frame.fps) * clip.speed;
  const rows = track.frames.filter((r) => r[0]! >= t0 - 0.05 && r[0]! <= t1 + 0.05 && r[6]! >= 0);
  if (!rows.length) return undefined;
  const L = mediaLayout(clip, asset.width, asset.height, frame.width, frame.height);
  const fx = (x: number) => (L.left + x * L.width) / frame.width;
  const fy = (y: number) => (L.top + y * L.height) / frame.height;
  const faceTop = median(rows.map((r) => r[7]!));
  const faceH = median(rows.map((r) => r[9]!));
  // Hair top measured above the face; older tracks estimate it from the silhouette.
  const measured = rows.map((r) => r[10] ?? -1).filter((v) => v >= 0);
  const silTop = median(rows.map((r) => (r[2]! >= 0 ? r[2]! : r[7]!)));
  const headTop = measured.length > rows.length / 2 ? median(measured) : Math.min(faceTop, Math.max(silTop, faceTop - 0.7 * faceH));
  const faceBottom = faceTop + faceH;
  const p: SubjectPlacement = {
    headTop: fy(headTop),
    faceTop: fy(faceTop),
    faceBottom: fy(faceBottom),
    faceCx: fx(median(rows.map((r) => r[6]! + r[8]! / 2))),
    bodyLeft: fx(median(rows.map((r) => (r[1]! >= 0 ? r[1]! : 0)))),
    bodyRight: fx(median(rows.map((r) => (r[1]! >= 0 ? r[1]! + r[3]! : 1)))),
    closeUp: false,
    usable: false,
  };
  p.closeUp = p.faceBottom - p.headTop > 0.35;
  p.usable = !p.closeUp && p.headTop >= 0.12;
  return p;
}

/**
 * Time ranges where captions must move up: a cut-out person boxed in the lower part of the
 * frame (green screen). Captions then sit just above that box. Timeline frames.
 */
export function captionRaises(m: Montage): { start: number; end: number; y: number }[] {
  const out: { start: number; end: number; y: number }[] = [];
  for (const t of m.tracks) {
    if (t.hidden) continue;
    for (const c of t.clips)
      if (c.type === "media" && c.cutout && c.box && c.box.y > 0.2) out.push({ start: c.start, end: clipEnd(c), y: Math.max(0.25, c.box.y - 0.04) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Time ranges where a screenshot scene fills the frame: captions get a backing box there. */
export function screenRanges(m: Montage): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const t of m.tracks) {
    if (t.hidden) continue;
    for (const c of t.clips) if (c.type === "graphic" && c.component === "ScreenshotShowcase") out.push({ start: c.start, end: clipEnd(c) });
  }
  return out.sort((a, b) => a.start - b.start);
}
