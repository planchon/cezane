import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Asset, Grade } from "@cezane/core";
import { cacheDir, ffmpeg, REPO_DIR, sha256 } from "./proc";

const BUILTIN = join(REPO_DIR, "assets/luts");
const USER = join(homedir(), "Cezane", "luts");

/** Where a LUT name points: the project's luts/, then ~/Cezane/luts, then the built-in ones. */
export function lutPath(name: string, projectDir?: string): string | undefined {
  const file = name.endsWith(".cube") ? name : `${name}.cube`;
  for (const dir of [projectDir && join(projectDir, "luts"), USER, BUILTIN]) if (dir && existsSync(join(dir, file))) return join(dir, file);
  return undefined;
}

/** Every LUT available to a project, by name. */
export function listLuts(projectDir?: string): string[] {
  const names = new Set<string>();
  for (const dir of [BUILTIN, USER, projectDir && join(projectDir, "luts")])
    if (dir && existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".cube")) names.add(basename(f, ".cube"));
  return [...names].sort();
}

const lutHashes = new Map<string, string>();
/** Content hash of a LUT file (so editing a .cube invalidates what used it). */
export function lutHash(path: string): string {
  if (!lutHashes.has(path)) lutHashes.set(path, sha256(readFileSync(path)).slice(0, 10));
  return lutHashes.get(path)!;
}

/** ffmpeg filter: the LUT at full strength, or mixed over the original. */
function lutFilter(path: string, intensity: number, alpha: boolean): string {
  const fmt = alpha ? "gbrap" : "gbrp";
  const lut = `lut3d=file='${path.replace(/'/g, "\\'")}':interp=tetrahedral`;
  return intensity >= 0.999
    ? `format=${fmt},${lut}`
    : `format=${fmt},split[o][g];[g]${lut}[l];[l][o]blend=all_mode=normal:all_opacity=${intensity.toFixed(3)}`;
}

/**
 * Graded copies of an asset (its normalized file, and its person cutout when it has one), cached
 * next to the source per LUT content and strength. Returns file names in the asset's cache dir.
 */
export async function gradeAsset(a: Asset, g: Grade, projectDir?: string): Promise<{ file: string; cutout?: string }> {
  const path = lutPath(g.lut, projectDir);
  if (!path) throw new Error(`LUT not found: ${g.lut}`);
  if (!a.derived.normalized) throw new Error(`asset ${a.id} is not ingested yet`);
  const dir = cacheDir(a.hash);
  const tag = `${lutHash(path)}-${Math.round(g.intensity * 100)}`;
  const image = a.kind === "image";
  const file = image ? `graded-${tag}.png` : `graded-${tag}.mp4`;
  if (!existsSync(join(dir, file))) {
    const tmp = join(dir, `${file}.tmp${image ? ".png" : ".mp4"}`);
    const filter = `${lutFilter(path, g.intensity, false)},format=yuv420p`;
    if (image) await ffmpeg(["-i", join(dir, a.derived.normalized), "-filter_complex", filter.replace(",format=yuv420p", ",format=rgb24"), "-frames:v", "1", tmp]);
    else await ffmpeg(["-i", join(dir, a.derived.normalized), "-filter_complex", filter, "-c:v", "h264_videotoolbox", "-b:v", "14M", "-g", "15", "-an", "-movflags", "+faststart", tmp], { duration: a.duration });
    await Bun.$`mv ${tmp} ${join(dir, file)}`.quiet();
  }
  let cutout: string | undefined;
  if (a.derived.cutout && existsSync(join(dir, a.derived.cutout))) {
    cutout = `graded-cutout-${tag}-${basename(a.derived.cutout, ".webm")}.webm`;
    if (!existsSync(join(dir, cutout))) {
      const tmp = join(dir, `${cutout}.tmp.webm`);
      await ffmpeg(
        [
          "-c:v", "libvpx-vp9", "-i", join(dir, a.derived.cutout),
          "-filter_complex", `${lutFilter(path, g.intensity, true)},format=yuva420p`,
          "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8", "-auto-alt-ref", "0",
          tmp,
        ],
        { duration: a.duration },
      );
      await Bun.$`mv ${tmp} ${join(dir, cutout)}`.quiet();
    }
  }
  return { file, cutout };
}


