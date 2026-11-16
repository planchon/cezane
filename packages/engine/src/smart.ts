import { type Analysis, type CaptionWord, type MediaClip, type Montage, type Op, type Transcript, clipEnd, mainTrack, mergeRanges, montageDuration } from "@cezane/core";

type Lookup<T> = (assetId: string) => T | undefined;

const FILLERS = /^(euh+|heu+|hum+|hmm+|um+|uh+|uhm+|erm+|ben|bah)[.,!?…]*$/i;

/** Visible source window of a media clip, in seconds. */
const srcWindow = (c: MediaClip, fps: number) => [c.srcIn, c.srcIn + (c.duration / fps) * c.speed] as const;
const toFrame = (c: MediaClip, t: number, fps: number) => c.start + Math.round(((t - c.srcIn) / c.speed) * fps);

/**
 * Deterministic silence (and filler word) removal on the main track: returns cut_range ops,
 * latest first so that each cut leaves the earlier ones valid.
 */
export function cutSilencesOps(
  m: Montage,
  analysis: Lookup<Analysis>,
  transcript: Lookup<Transcript>,
  o: { minSilence?: number; padding?: number; fillers?: boolean; clipIds?: string[] } = {},
): { ops: Op[]; removedFrames: number } {
  const fps = m.settings.fps;
  const min = o.minSilence ?? 0.4;
  const pad = o.padding ?? 0.1;
  const ranges: { start: number; end: number }[] = [];
  for (const c of mainTrack(m)?.clips ?? []) {
    if (c.type !== "media" || (o.clipIds && !o.clipIds.includes(c.id))) continue;
    const [w0, w1] = srcWindow(c, fps);
    const gaps: { start: number; end: number }[] = [...(analysis(c.assetId)?.silences ?? [])];
    const words = transcript(c.assetId)?.words ?? [];
    if (o.fillers) for (const w of words) if (FILLERS.test(w.text.trim())) gaps.push({ start: w.start - 0.05, end: w.end + 0.05 });
    // Also the gaps between transcribed words (more precise than the noise threshold).
    for (let i = 1; i < words.length; i++) if (words[i]!.start - words[i - 1]!.end >= min + 2 * pad) gaps.push({ start: words[i - 1]!.end, end: words[i]!.start });
    for (const g of gaps) {
      const isFiller = g.end - g.start < min + 2 * pad;
      const s = Math.max(w0, isFiller ? g.start : g.start + pad);
      const e = Math.min(w1, isFiller ? g.end : g.end - pad);
      if (e - s < (isFiller ? 0.05 : min)) continue;
      const fs = Math.max(c.start, toFrame(c, s, fps));
      const fe = Math.min(clipEnd(c), toFrame(c, e, fps));
      if (fe - fs >= 2) ranges.push({ start: fs, end: fe });
    }
  }
  const merged = mergeRanges(ranges).sort((a, b) => b.start - a.start);
  return { ops: merged.map((r) => ({ op: "cut_range" as const, start: r.start, end: r.end })), removedFrames: merged.reduce((n, r) => n + r.end - r.start, 0) };
}

/** Timeline words of the main track (source transcript mapped through the edit). */
export function timelineWords(m: Montage, transcript: Lookup<Transcript>): CaptionWord[] {
  const fps = m.settings.fps;
  const out: CaptionWord[] = [];
  for (const c of mainTrack(m)?.clips ?? []) {
    if (c.type !== "media" || c.muted) continue;
    const [w0, w1] = srcWindow(c, fps);
    for (const w of transcript(c.assetId)?.words ?? []) {
      const mid = (w.start + w.end) / 2;
      if (mid < w0 || mid >= w1) continue;
      const start = Math.max(c.start, toFrame(c, w.start, fps));
      const end = Math.min(clipEnd(c), Math.max(start + 2, toFrame(c, w.end, fps)));
      out.push({ text: w.text, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Captions clip built from the transcript: replaces the captions of the captions track. */
export function captionsOps(
  m: Montage,
  transcript: Lookup<Transcript>,
  o: { style?: "bold" | "karaoke" | "minimal" | "box"; position?: "top" | "center" | "bottom"; color?: string; wordsPerPage?: number; track?: string } = {},
): { ops: Op[]; words: number } {
  const per = o.wordsPerPage ?? 3;
  const words = timelineWords(m, transcript).filter((w) => !FILLERS.test(w.text.trim()));
  let count = 0;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const br = i === 0 || count >= per || (prev !== undefined && (w.start - prev.end >= 10 || /[.!?…]$/.test(prev.text)));
    if (br) count = 0;
    w.br = br;
    count++;
  });
  const track = o.track ?? m.tracks.find((t) => t.role === "captions")?.id ?? "t_caps";
  const ops: Op[] = [];
  if (!m.tracks.some((t) => t.id === track)) ops.push({ op: "add_track", kind: "overlay", role: "captions", name: "Captions", id: track });
  for (const t of m.tracks) for (const c of t.clips) if (c.type === "captions" && t.id === track) ops.push({ op: "remove_clip", id: c.id });
  const dur = montageDuration(m);
  if (words.length && dur > 0)
    ops.push({ op: "add_clip", track, clip: { type: "captions", start: 0, duration: dur, style: o.style ?? "bold", position: o.position ?? "bottom", color: o.color, words } });
  return { ops, words: words.length };
}

/** Compact timestamped transcript: one line per phrase. `frames` prefixes timeline frames. */
export function transcriptLines(words: { text: string; start: number; end: number }[], unit: "s" | "f", fps = 30): string {
  const lines: string[] = [];
  let cur: string[] = [];
  let t0 = 0;
  const stamp = (t: number) => (unit === "s" ? `${t.toFixed(2)}s` : `f${t} ${(t / fps).toFixed(2)}s`);
  words.forEach((w, i) => {
    if (!cur.length) t0 = w.start;
    cur.push(w.text);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    if (!next || /[.!?…]$/.test(w.text) || gap >= (unit === "s" ? 0.5 : fps / 2) || cur.length >= 14) {
      lines.push(`[${stamp(t0)}–${stamp(w.end)}] ${cur.join(" ")}`);
      cur = [];
    }
  });
  return lines.join("\n");
}
