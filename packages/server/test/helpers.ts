import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg } from "@cezane/engine";

/** A temporary folder removed by `cleanup()`. */
export function tempDir(prefix = "cezane-test-") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); // /var → /private/var, as the registry stores it
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A small PNG of one color (distinct colors = distinct content hashes). */
export async function png(path: string, color = "red", size = 32) {
  await ffmpeg(["-f", "lavfi", "-i", `color=c=${color}:s=${size}x${size}`, "-frames:v", "1", path]);
  return path;
}

/** Polls `pred` until it returns a truthy value (or throws after `ms`). */
export async function until<T>(pred: () => T | undefined | false | Promise<T | undefined | false>, ms = 10_000, label = "condition"): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`);
    await Bun.sleep(50);
  }
}
