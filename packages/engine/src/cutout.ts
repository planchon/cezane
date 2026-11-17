import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Asset } from "@cezane/core";
import { cacheDir, PACKAGED, REPO_DIR, run, runOk } from "./proc";

const VISION_DIR = join(REPO_DIR, "native/vision");
const VISION_BUILD = join(VISION_DIR, ".build/release/cezane-vision");
/** Prebuilt by scripts/release-mac.ts into the packaged runtime (bin/cezane-vision). */
export const VISION_PREBUILT = join(REPO_DIR, "bin/cezane-vision");

/** The Apple Vision helper: the prebuilt one when shipped, else built from native/vision in the checkout. */
async function visionBin(): Promise<string> {
  if (process.env.CEZANE_VISION_BIN) return process.env.CEZANE_VISION_BIN;
  if (existsSync(VISION_PREBUILT)) return VISION_PREBUILT;
  if (PACKAGED) throw new Error(`cezane-vision missing from the app (${VISION_PREBUILT})`);
  if (!existsSync(VISION_BUILD)) await runOk(["swift", "build", "-c", "release"], { cwd: VISION_DIR });
  return VISION_BUILD;
}

/** Bumped when the matte or the subject track changes (v3: edge-aware matte, subject track with hair top). */
export const CUTOUT_VERSION = 3;

/**
 * Person cutout (transparent background) with Apple Vision, plus the subject track (silhouette
 * box and face per frame). Cached per source and quality.
 */
export async function cutout(
  asset: Asset,
  onProgress: (p: number) => void,
  quality: "fast" | "balanced" | "accurate" = "balanced",
): Promise<{ cutout: string; subject: string }> {
  const dir = cacheDir(asset.hash);
  const name = `cutout-v${CUTOUT_VERSION}-${quality}.webm`;
  const subject = `subject-v${CUTOUT_VERSION}-${quality}.json`;
  if (existsSync(join(dir, name)) && existsSync(join(dir, subject))) return { cutout: name, subject };
  if (!asset.derived.normalized) throw new Error(`asset ${asset.id} is not ingested yet`);
  const bin = await visionBin();
  const tmp = join(dir, `${name}.tmp.webm`);
  const r = await run([bin, "cutout", join(dir, asset.derived.normalized), tmp, "--quality", quality, "--subject", join(dir, subject)], {
    onStdout: (s) => {
      const m = /progress ([\d.]+)/.exec(s.split("\n").filter(Boolean).at(-1) ?? "");
      if (m) onProgress(Number(m[1]));
    },
  });
  if (r.code !== 0) throw new Error(`cutout failed: ${r.stderr.trim().split("\n").slice(-3).join(" ")}`);
  await Bun.$`mv ${tmp} ${join(dir, name)}`.quiet();
  return { cutout: name, subject };
}

/** Person cutout of a still image (PNG with alpha). */
export async function cutoutImage(input: string, out: string): Promise<void> {
  await runOk([await visionBin(), "mask-image", input, out, "--quality", "accurate"]);
}
