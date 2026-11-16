import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Asset } from "@cezane/core";
import { cacheDir, REPO_DIR, run, runOk } from "./proc";

const VISION_DIR = join(REPO_DIR, "native/vision");
const VISION_BIN = join(VISION_DIR, ".build/release/cezane-vision");

async function visionBin(): Promise<string> {
  if (!existsSync(VISION_BIN)) await runOk(["swift", "build", "-c", "release"], { cwd: VISION_DIR });
  return VISION_BIN;
}

/** Person cutout (transparent background) with Apple Vision, cached per source and quality. */
export async function cutout(asset: Asset, onProgress: (p: number) => void, quality: "fast" | "balanced" | "accurate" = "balanced"): Promise<string> {
  const dir = cacheDir(asset.hash);
  const name = `cutout-${quality}.webm`;
  if (existsSync(join(dir, name))) return name;
  if (!asset.derived.normalized) throw new Error(`asset ${asset.id} is not ingested yet`);
  const bin = await visionBin();
  const tmp = join(dir, `${name}.tmp.webm`);
  const r = await run([bin, "cutout", join(dir, asset.derived.normalized), tmp, "--quality", quality], {
    onStdout: (s) => {
      const m = /progress ([\d.]+)/.exec(s.split("\n").filter(Boolean).at(-1) ?? "");
      if (m) onProgress(Number(m[1]));
    },
  });
  if (r.code !== 0) throw new Error(`cutout failed: ${r.stderr.trim().split("\n").slice(-3).join(" ")}`);
  await Bun.$`mv ${tmp} ${join(dir, name)}`.quiet();
  return name;
}

/** Person cutout of a still image (PNG with alpha). */
export async function cutoutImage(input: string, out: string): Promise<void> {
  await runOk([await visionBin(), "mask-image", input, out, "--quality", "accurate"]);
}
