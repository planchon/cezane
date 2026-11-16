import type { Asset, Clip, Comment, Montage, Track } from "@cezane/core";
import { AudioLines, Captions, Component, Film, Image as ImageIcon, Layers, type LucideIcon, Music2, Smartphone, Sparkles, UserRound } from "lucide-react";

/** Assets Claude made: generations and app captures (shown in terre cuite). */
export const claudeMade = (a?: Asset) => a?.provenance.type === "generated" || a?.provenance.type === "capture";

export const trackIcon = (t: Track): LucideIcon =>
  t.role === "main" || t.role === "voice"
    ? UserRound
    : t.role === "graphics"
      ? Component
      : t.role === "captions"
        ? Captions
        : t.role === "music"
          ? Music2
          : t.kind === "audio"
            ? AudioLines
            : t.role === "broll"
              ? Film
              : Layers;

export function clipIcon(c: Clip, t: Track, asset?: Asset): LucideIcon {
  if (c.type === "graphic") return Component;
  if (c.type === "captions") return Captions;
  if (t.kind === "audio") return t.role === "music" ? Music2 : AudioLines;
  if (asset?.provenance.type === "capture") return Smartphone;
  if (asset?.provenance.type === "generated") return Sparkles;
  if (t.role === "main" || t.role === "voice") return UserRound;
  return asset?.kind === "image" ? ImageIcon : Film;
}

export function clipLabel(c: Clip, asset?: Asset): string {
  if (c.type === "media") return asset?.name ?? c.assetId;
  if (c.type === "graphic") {
    const p = c.props as Record<string, unknown>;
    const detail = typeof p.text === "string" ? p.text : typeof p.name === "string" ? p.name : "";
    return detail ? `${c.component} · ${detail}` : c.component;
  }
  return "Sous-titres";
}

export type Shot = { clip: Clip; track: Track; phrase?: string; children: { clip: Clip; track: Track }[] };

/**
 * The montage as a list of shots: the clips of the main track, each with what is said over it
 * (caption words) and the overlay/audio clips that start during it.
 */
export function shotsOf(m?: Montage): Shot[] {
  if (!m) return [];
  const main = m.tracks.find((t) => t.role === "main") ?? m.tracks.find((t) => t.kind === "video");
  if (!main) return [];
  const words = m.tracks
    .flatMap((t) => t.clips)
    .flatMap((c) => (c.type === "captions" ? c.words.map((w) => ({ text: w.text, at: c.start + w.start })) : []))
    .sort((a, b) => a.at - b.at);
  const others = m.tracks.filter((t) => t !== main).flatMap((t) => t.clips.map((clip) => ({ clip, track: t })));
  return [...main.clips]
    .sort((a, b) => a.start - b.start)
    .map((clip) => {
      const end = clip.start + clip.duration;
      const phrase = words
        .filter((w) => w.at >= clip.start && w.at < end)
        .map((w) => w.text)
        .join(" ");
      const children = others.filter((o) => o.clip.start >= clip.start && o.clip.start < end).sort((a, b) => a.clip.start - b.clip.start);
      return { clip, track: main, phrase: phrase || undefined, children };
    });
}

/** Open comments (not validated) per clip they were made on. */
export function openCommentsByClip(comments: Comment[]) {
  const by = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.anchor.kind !== "montage" || c.status === "validated" || !c.anchor.content) continue;
    const id = c.anchor.content.clipId;
    by.set(id, [...(by.get(id) ?? []), c]);
  }
  return by;
}

/** Avatar shown for a comment: C once Claude fixed it, grey once validated, P otherwise. */
export const commentAvatar = (c: Comment): { cls: string; letter: string } =>
  c.status === "fixed" ? { cls: "cl", letter: "C" } : c.status === "validated" ? { cls: "done", letter: "P" } : { cls: "me", letter: "P" };
