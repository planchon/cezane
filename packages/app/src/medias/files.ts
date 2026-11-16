import type { Asset, Montage, Op, ProjectFile } from "@cezane/core";
import { newId } from "@cezane/core";
import { post } from "../api";
import { playhead } from "../store";
import { clockShort, relTime } from "../ui/format";
import { attempt, toast } from "../ui/toast";

/** "2,1 Mo" */
export function formatSize(bytes: number): string {
  const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: n < 10 ? 1 : 0 });
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${fmt(bytes / 1024)} Ko`;
  if (bytes < 1024 ** 3) return `${fmt(bytes / 1024 ** 2)} Mo`;
  return `${fmt(bytes / 1024 ** 3)} Go`;
}

export const formatCost = (eur: number) => `${eur.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** "/Users/paul/Cezane/Projets/Dax" → "~/Cezane/Projets/Dax" */
export const tildePath = (abs: string) => abs.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");

export const duration = (s: number) => clockShort(s, 1);

/** Second line under a file in the viewer: duration and origin, or when it was made. */
export function fileSub(f: ProjectFile): string {
  if (f.version) return `V${f.version.n}${f.duration ? ` · ${duration(f.duration)}` : ""}`;
  if (f.duration && f.kind !== "image") return [duration(f.duration), f.capture ? "capture" : f.generated ? "généré" : undefined].filter(Boolean).join(" · ");
  return relTime(f.createdAt);
}

/** Shows a file (or the project folder) in the Finder. */
export const reveal = (target: { path?: string; assetId?: string; versionId?: string } = {}) => attempt(() => post("/api/reveal", target));

// ───────────────────────── Ajouter au montage ─────────────────────────

const IMAGE_SECONDS = 3;

/**
 * Adds an asset to the current montage at the playhead, through the montage's `add_clip` edit op:
 * images and videos on the B-roll track (created if the montage has none), sounds on the
 * sound-effects track (short) or the music track (long).
 */
export async function addToMontage(asset: Asset, montage: Montage) {
  const fps = montage.settings.fps;
  const total = Math.max(1, ...montage.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)));
  const start = Math.min(Math.max(0, Math.round(playhead.get())), total);
  const seconds = asset.kind === "image" ? IMAGE_SECONDS : (asset.duration ?? IMAGE_SECONDS);
  const frames = Math.max(1, Math.round(seconds * fps));
  const ops: Op[] = [];
  let track: { id: string; name: string } | undefined;
  if (asset.kind === "audio") {
    const role = seconds < 6 ? "sfx" : "music";
    track = montage.tracks.find((t) => t.kind === "audio" && t.role === role);
    if (!track) {
      track = { id: newId("t"), name: role === "sfx" ? "Bruitages" : "Musique" };
      ops.push({ op: "add_track", kind: "audio", role, name: track.name, id: track.id, index: 0 });
    }
  } else {
    track = montage.tracks.find((t) => t.role === "broll") ?? montage.tracks.find((t) => t.kind === "overlay");
    if (!track) {
      track = { id: newId("t"), name: "B-roll" };
      ops.push({ op: "add_track", kind: "overlay", role: "broll", name: track.name, id: track.id });
    }
  }
  // At the playhead, or at the first gap after it that is long enough: never over another clip of the track.
  const taken = (montage.tracks.find((t) => t.id === track.id)?.clips ?? []).map((c) => [c.start, c.start + c.duration] as const).sort((a, b) => a[0] - b[0]);
  let at = start;
  for (const [s, e] of taken) if (at < e && at + frames > s) at = e;
  ops.push({ op: "add_clip", track: track.id, clip: { type: "media", assetId: asset.id, start: at, duration: frames, muted: asset.kind === "video" } as never });
  const r = await attempt(() => post("/api/edit", { ops, reason: `Ajout de ${asset.name} depuis Médias` }));
  if (r !== undefined) toast(`Ajouté au montage · ${track.name} à ${clockShort(at, fps)}`);
}
