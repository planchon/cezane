import type { CaptionWord, FrameRange, MediaClip, Montage } from "./schema";
import { clipEnd, mainTrack, montageDuration } from "./timeline";
import { captionRaises, mainClipsIn, screenRanges } from "./subject";

/** Max segment length in frames: long shots are re-cut from their start every MAX frames. */
export const SEGMENT_MAX = 150;

/** Segments follow the shots of the main track, so a shift in time does not change their content. */
export function planSegments(m: Montage, max = SEGMENT_MAX): FrameRange[] {
  const total = montageDuration(m);
  if (total === 0) return [];
  const cuts = new Set<number>([0, total]);
  const main = mainTrack(m);
  for (const c of main?.clips ?? []) {
    for (let f = c.start; f < clipEnd(c); f += max) cuts.add(f);
    cuts.add(Math.min(clipEnd(c), total));
  }
  const sorted = [...cuts].filter((f) => f >= 0 && f <= total).sort((a, b) => a - b);
  const out: FrameRange[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    let s = sorted[i]!;
    const e = sorted[i + 1]!;
    // Gaps between shots (or after the main track ends) are split on the same grid.
    while (e - s > max) {
      out.push({ start: s, end: s + max });
      s += max;
    }
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

export type SegmentContext = {
  assetHash: (assetId: string) => string;
  componentVersion: (component: string) => string;
  renderVersion: string;
  /** Hash of the person cutout for an asset, when the clip uses it. */
  cutoutHash?: (assetId: string) => string;
  /** Identity of the grade a media clip gets (LUT content, strength, vignette), or null. */
  gradeOf?: (clip: MediaClip) => string | null;
};

/** Words of captions animate in ~10 frames: a caption word just before the segment can still show. */
const CAPTION_LOOKBEHIND = 30;

/**
 * Everything visible in a segment, described relative to the segment start.
 * Its stable hash is the segment cache key.
 */
export function segmentDescriptor(m: Montage, seg: FrameRange, ctx: SegmentContext): unknown {
  const items: unknown[] = [];
  const fps = m.settings.fps;
  m.tracks.forEach((t, ti) => {
    if (t.hidden || t.kind === "audio") return;
    for (const c of t.clips) {
      const ce = clipEnd(c);
      if (ce <= seg.start || c.start >= seg.end) continue;
      const rel = c.start - seg.start;
      if (c.type === "media") {
        const animated = Boolean(c.zoom || c.transitionIn);
        const visFrom = Math.max(c.start, seg.start);
        const visTo = Math.min(ce, seg.end);
        items.push({
          ti,
          t: "media",
          src: ctx.assetHash(c.assetId),
          cut: c.cutout ? (ctx.cutoutHash?.(c.assetId) ?? "cutout") : null,
          box: c.box ?? null,
          outline: c.outline ?? null,
          grade: ctx.gradeOf?.(c) ?? null,
          fit: c.fit,
          focus: c.focus,
          opacity: c.opacity,
          speed: c.speed,
          // An animated clip depends on its whole extent; a plain one only on what is visible.
          ...(animated
            ? { rel, dur: c.duration, srcIn: c.srcIn, zoom: c.zoom ?? null, tr: c.transitionIn ?? null }
            : {
                from: visFrom - seg.start,
                to: visTo - seg.start,
                srcAt: +(c.srcIn + ((visFrom - c.start) / fps) * c.speed).toFixed(4),
              }),
        });
      } else if (c.type === "graphic") {
        // Behind the person: the result also depends on the cutout (and placement) of the main track below.
        const behind = c.behind
          ? mainClipsIn(m, Math.max(c.start, seg.start), Math.min(ce, seg.end)).map((mc) => ({
              cut: ctx.cutoutHash?.(mc.assetId) ?? "cutout",
              rel: mc.start - seg.start,
              srcIn: mc.srcIn,
              speed: mc.speed,
              fit: mc.fit,
              focus: mc.focus,
              box: mc.box ?? null,
              zoom: mc.zoom ?? null,
            }))
          : null;
        items.push({ ti, t: "graphic", comp: c.component, v: ctx.componentVersion(c.component), rel, dur: c.duration, props: c.props, behind });
      } else {
        // Only the pages on screen during the segment matter, never the clip start.
        const pages = captionPages(c.words)
          .filter((p) => c.start + p.at(-1)!.end > seg.start - CAPTION_LOOKBEHIND && c.start + p[0]!.start < seg.end)
          .map((p) => p.map((w) => [w.text, c.start + w.start - seg.start, c.start + w.end - seg.start]));
        items.push({
          ti,
          t: "captions",
          style: c.style,
          pos: c.position,
          y: c.y ?? null,
          raise: captionRaises(m)
            .filter((r) => r.start < seg.end && r.end > seg.start)
            .map((r) => [r.start - seg.start, r.end - seg.start, r.y]),
          screens: screenRanges(m)
            .filter((r) => r.start < seg.end && r.end > seg.start)
            .map((r) => [r.start - seg.start, r.end - seg.start]),
          color: c.color ?? null,
          pages,
          v: ctx.componentVersion("Captions"),
          from: Math.max(c.start, seg.start) - seg.start,
          to: Math.min(ce, seg.end) - seg.start,
        });
      }
    }
  });
  return { len: seg.end - seg.start, s: m.settings, r: ctx.renderVersion, items };
}

/** JSON with sorted keys, so equal content always gives equal text. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** Merges adjacent frame ranges. */
export function mergeRanges(ranges: FrameRange[]): FrameRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: FrameRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Groups caption words into pages (what is on screen at once). Explicit `br` flags win;
 * without any, a page ends after 3 words, a pause of 10+ frames, or end punctuation.
 */
export function captionPages(words: CaptionWord[]): CaptionWord[][] {
  const pages: CaptionWord[][] = [];
  const explicit = words.some((w) => w.br);
  let cur: CaptionWord[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const breakHere = explicit
      ? Boolean(w.br)
      : cur.length >= 3 || (prev !== undefined && (w.start - prev.end >= 10 || /[.!?…]$/.test(prev.text)));
    if (cur.length && breakHere) {
      pages.push(cur);
      cur = [];
    }
    cur.push(w);
  });
  if (cur.length) pages.push(cur);
  return pages;
}
