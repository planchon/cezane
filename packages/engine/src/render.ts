import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  type Asset,
  type FrameRange,
  type LookItem,
  type Montage,
  type RenderAsset,
  type TimelineProps,
  mergeRanges,
  montageDuration,
  planSegments,
  segmentDescriptor,
  stableStringify,
} from "@cezane/core";
import { audioKey, mixAudio } from "./audio";
import { CACHE_DIR, ffmpeg, REPO_DIR, sha256 } from "./proc";
import type { RenderWorker } from "./worker";

export type RenderEnv = {
  worker: RenderWorker;
  projectDir: string;
  assets: Map<string, Asset>;
  baseUrl: string; // where the cezane server serves /files
};

const REMOTION_SRC = join(REPO_DIR, "packages/remotion/src");

/** Code versions: one per graphic component file, one for the rest of the Remotion code. */
export function codeVersions(): { component: (name: string) => string; render: string } {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css|json)$/.test(f)) files.push(p);
    }
  };
  if (existsSync(REMOTION_SRC)) walk(REMOTION_SRC);
  const gfx = new Map<string, string>();
  const rest: string[] = [];
  for (const f of files.sort()) {
    const rel = relative(REMOTION_SRC, f);
    const text = readFileSync(f, "utf8");
    const m = /^graphics\/([^/]+)\.tsx$/.exec(rel);
    if (m) gfx.set(m[1]!, sha256(text));
    else rest.push(`${rel}:${sha256(text)}`);
  }
  return { component: (n) => gfx.get(n) ?? "none", render: sha256(rest.join("|")) };
}

export function fileUrl(env: Pick<RenderEnv, "baseUrl">, a: Asset, file: string | undefined): string | undefined {
  return file ? `${env.baseUrl}/files/cache/${a.hash}/${file}` : undefined;
}

export function timelineProps(m: Montage, env: Pick<RenderEnv, "assets" | "baseUrl">): TimelineProps {
  const assets: Record<string, RenderAsset> = {};
  for (const a of env.assets.values()) {
    const url = a.kind === "audio" ? fileUrl(env, a, a.derived.audio) : fileUrl(env, a, a.derived.normalized);
    if (!url) continue;
    assets[a.id] = { kind: a.kind, url, width: a.width, height: a.height, duration: a.duration, cutoutUrl: fileUrl(env, a, a.derived.cutout) };
  }
  return { montage: m, assets };
}

export type RenderResult = { keys: string[]; changed: FrameRange[]; rendered: number; total: number; seconds: number };

/**
 * Renders a montage to `out`: only the segments whose content changed are rendered again,
 * the soundtrack is mixed apart, then everything is joined without re-encoding.
 */
export async function renderMontage(
  m: Montage,
  env: RenderEnv,
  out: string,
  prevKeys: string[],
  onProgress: (p: number, label: string) => void,
): Promise<RenderResult> {
  const t0 = performance.now();
  const total = montageDuration(m);
  if (total === 0) throw new Error("the montage is empty");
  const versions = codeVersions();
  const ctx = {
    assetHash: (id: string) => env.assets.get(id)?.hash ?? `missing:${id}`,
    componentVersion: versions.component,
    renderVersion: versions.render,
    cutoutHash: (id: string) => `${env.assets.get(id)?.hash}:${env.assets.get(id)?.derived.cutout ?? "none"}`,
  };
  const segs = planSegments(m);
  const keys = segs.map((s) => sha256(stableStringify(segmentDescriptor(m, s, ctx))));
  const segDir = join(env.projectDir, ".cezane/segments");
  const audioDir = join(env.projectDir, ".cezane/audio");
  mkdirSync(segDir, { recursive: true });
  mkdirSync(audioDir, { recursive: true });
  const props = timelineProps(m, env);
  const todo = segs.map((s, i) => ({ s, key: keys[i]! })).filter(({ key }) => !existsSync(join(segDir, `${key}.mp4`)));
  const todoFrames = todo.reduce((n, x) => n + x.s.end - x.s.start, 0);
  let doneFrames = 0;
  const videoShare = 0.85;
  for (const { s, key } of todo) {
    const len = s.end - s.start;
    const tmp = join(segDir, `${key}.tmp.mp4`);
    await env.worker.request("segment", { props, start: s.start, end: s.end, out: tmp }, (p) =>
      onProgress(((doneFrames + p * len) / Math.max(1, todoFrames)) * videoShare, `segments ${todo.indexOf(todo.find((x) => x.key === key)!) + 1}/${todo.length}`),
    );
    renameSync(tmp, join(segDir, `${key}.mp4`));
    doneFrames += len;
  }
  onProgress(videoShare, "son");
  const wavPath = (a: Asset) => (a.derived.audio ? join(CACHE_DIR, a.hash, a.derived.audio) : undefined);
  const audio = join(audioDir, `${audioKey(m, env.assets, wavPath)}.m4a`);
  await mixAudio(m, env.assets, wavPath, audio, (p) => onProgress(videoShare + p * 0.1, "son"));
  onProgress(0.96, "assemblage");
  const list = join(segDir, `concat-${Date.now()}.txt`);
  await Bun.write(list, keys.map((k) => `file '${join(segDir, `${k}.mp4`)}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-i", audio, "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", "-t", (total / m.settings.fps).toFixed(3), out]);
  await Bun.$`rm -f ${list}`.quiet();
  const prev = new Set(prevKeys);
  const changed = mergeRanges(segs.filter((_, i) => !prev.has(keys[i]!)));
  return { keys, changed, rendered: todo.length, total: segs.length, seconds: (performance.now() - t0) / 1000 };
}

/** One image with several labeled frames (and optional zoomed regions), for Claude. */
export async function look(m: Montage, env: RenderEnv, items: LookItem[], out: string, columns?: number): Promise<string> {
  await env.worker.request("look", { props: { ...timelineProps(m, env), items, columns }, out });
  return out;
}

export async function still(m: Montage, env: RenderEnv, frame: number, out: string, scale = 0.5): Promise<string> {
  await env.worker.request("still", { props: timelineProps(m, env), frame, out, scale });
  return out;
}
