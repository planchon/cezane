import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Asset, Comment, Montage, Project, ReelSummary, Version } from "@cezane/core";

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** URL of a project file, served by /files/p/<projectId>/… */
export const projectFileUrl = (projectId: string, rel?: string) => (rel ? `/files/p/${encodeURIComponent(projectId)}/${enc(rel)}` : undefined);

/** A still for an asset: the video poster, or the image itself. */
export function assetStill(projectId: string, a: Asset): string | undefined {
  if (a.kind === "video") return a.derived.poster ? `/files/cache/${encodeURIComponent(a.hash)}/${enc(a.derived.poster)}` : undefined;
  if (a.kind !== "image") return undefined;
  return a.derived.normalized ? `/files/cache/${encodeURIComponent(a.hash)}/${enc(a.derived.normalized)}` : projectFileUrl(projectId, a.file);
}

// Montages of projects that are not loaded, read from disk once per change of the file.
const montageMemo = new Map<string, { mtime: number; montage?: Montage }>();
export function readMontage(dir: string, id: string): Montage | undefined {
  const p = join(dir, "montages", `${id}.json`);
  if (!existsSync(p)) return undefined;
  const mtime = statSync(p).mtimeMs;
  const hit = montageMemo.get(p);
  if (hit?.mtime === mtime) return hit.montage;
  let montage: Montage | undefined;
  try {
    montage = JSON.parse(readFileSync(p, "utf8")) as Montage;
  } catch {}
  montageMemo.set(p, { mtime, montage });
  return montage;
}

const OPEN = new Set<Comment["status"]>(["draft", "sent", "in_progress", "reopened"]);

/** Asset ids mentioned in graphic props (a screenshot showcase, a picture-in-picture…). */
function assetIdsIn(v: unknown, assets: Map<string, Asset>, out: string[] = []): string[] {
  if (typeof v === "string") {
    if (assets.has(v)) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) assetIdsIn(x, assets, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) assetIdsIn(x, assets, out);
  return out;
}

/** Up to `n` items spread over the list: first, middle, last. */
function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]!);
}

/**
 * The reels of a project for the home tab, the tabs and the reel menu: status from the latest
 * version, comment counts, three stills, the rushes on the main and B-roll tracks.
 */
export function reelSummaries(o: {
  projectId: string;
  dir: string;
  project: Partial<Project>;
  versions: Version[];
  comments: Comment[];
  montage: (id: string) => Montage | undefined;
  activeId?: string;
  claudeOn?: string; // montage id Claude is working on
}): ReelSummary[] {
  const refs = o.project.montages ?? [];
  const first = refs[0]?.id;
  const reelOf = (id: string | undefined) => (refs.some((m) => m.id === id) ? id : first);
  const assets = new Map((o.project.assets ?? []).map((a) => [a.id, a]));
  const url = (rel?: string) => projectFileUrl(o.projectId, rel);
  return refs.map((ref) => {
    const vs = o.versions.filter((v) => reelOf(v.montageId) === ref.id);
    const cs = o.comments.filter((c) => c.anchor.kind === "montage" && reelOf(c.anchor.montageId) === ref.id);
    const last = vs.at(-1);
    const ready = [...vs].reverse().find((v) => v.status === "ready" && v.file);
    const m = o.montage(ref.id);

    // Stills in timeline order (media clips, and assets shown by graphics), spread over the reel.
    const clips = (m?.tracks ?? [])
      .filter((t) => t.kind !== "audio" && !t.hidden)
      .flatMap((t) => t.clips)
      .sort((a, b) => a.start - b.start);
    const stills: string[] = [];
    for (const c of clips) {
      const ids = c.type === "media" ? [c.assetId] : c.type === "graphic" ? assetIdsIn(c.props, assets) : [];
      for (const id of ids) {
        const a = assets.get(id);
        const s = a && assetStill(o.projectId, a);
        if (s && !stills.includes(s)) stills.push(s);
      }
    }
    let frames = spread(stills, 3);
    const poster = url(ready?.poster);
    if (frames.length < 3 && poster) frames = [poster, ...frames];
    if (!frames.length)
      frames = [...assets.values()]
        .filter((a) => a.kind === "video" || a.kind === "image")
        .map((a) => assetStill(o.projectId, a))
        .filter((s): s is string => Boolean(s))
        .slice(0, 3);

    const distinct = (pred: (t: Montage["tracks"][number]) => boolean) =>
      new Set((m?.tracks ?? []).filter(pred).flatMap((t) => t.clips.flatMap((c) => (c.type === "media" ? [c.assetId] : [])))).size;
    const mainId = m?.tracks.find((t) => t.role === "main")?.id ?? m?.tracks.find((t) => t.kind === "video")?.id;

    const stamps = [last?.createdAt, (() => {
      const p = join(o.dir, "montages", `${ref.id}.json`);
      return existsSync(p) ? new Date(statSync(p).mtimeMs).toISOString() : undefined;
    })()].filter((x): x is string => Boolean(x));

    return {
      id: ref.id,
      name: ref.name,
      status: last?.status ?? "draft",
      versions: vs.length,
      lastVersion: last && {
        id: last.id,
        n: last.n,
        status: last.status,
        createdAt: last.createdAt,
        durationSeconds: +(last.durationFrames / last.fps).toFixed(2),
        author: last.author,
      },
      thumbUrl: poster,
      videoUrl: url(ready?.file),
      exportUrl: ready?.exportFile && existsSync(join(o.dir, ready.exportFile)) ? url(ready.exportFile) : undefined,
      active: o.activeId ? ref.id === o.activeId : undefined,
      claude: o.claudeOn === ref.id || undefined,
      frames,
      comments: { open: cs.filter((c) => OPEN.has(c.status)).length, toReview: cs.filter((c) => c.status === "fixed").length },
      rushes: { aroll: distinct((t) => t.id === mainId), broll: distinct((t) => t.id !== mainId && t.kind !== "audio" && t.role !== "graphics" && t.role !== "captions") },
      modifiedAt: stamps.sort().at(-1),
    };
  });
}
