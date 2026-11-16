import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Command that starts the render worker (absolute paths, works from any cwd). */
export function workerCommand(): string[] {
  const bun = process.versions.bun ? process.execPath : "bun";
  return [bun, join(here, "worker.ts")];
}
