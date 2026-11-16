import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const CEZANE_HOME = process.env.CEZANE_HOME ?? join(homedir(), "Cezane");
export const CACHE_DIR = join(CEZANE_HOME, "cache");
export const LIBRARY_DIR = join(CEZANE_HOME, "library");
export const MODELS_DIR = join(CEZANE_HOME, "models");
export const REPO_DIR = join(import.meta.dir, "../../..");

/** Global ingestion cache of one source file, keyed by its content hash. */
export function cacheDir(hash: string): string {
  const dir = join(CACHE_DIR, hash);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export type RunResult = { code: number; stdout: string; stderr: string };

/** Runs a command to completion. `onStderr` receives stderr chunks as they arrive (ffmpeg progress). */
export async function run(
  cmd: string[],
  opts: { cwd?: string; onStderr?: (chunk: string) => void; onStdout?: (chunk: string) => void; signal?: AbortSignal; stdin?: string } = {},
): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : "ignore",
  });
  opts.signal?.addEventListener("abort", () => proc.kill());
  const read = async (stream: ReadableStream<Uint8Array>, cb?: (s: string) => void) => {
    const dec = new TextDecoder();
    let all = "";
    for await (const chunk of stream) {
      const s = dec.decode(chunk, { stream: true });
      all += s;
      cb?.(s);
    }
    return all;
  };
  const [stdout, stderr] = await Promise.all([read(proc.stdout, opts.onStdout), read(proc.stderr, opts.onStderr)]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

export async function runOk(cmd: string[], opts: Parameters<typeof run>[1] = {}): Promise<RunResult> {
  const r = await run(cmd, opts);
  if (r.code !== 0) {
    const tail = r.stderr.trim().split("\n").slice(-6).join("\n");
    throw new Error(`${cmd[0]} failed (${r.code}): ${tail}`);
  }
  return r;
}

export const FFMPEG = Bun.which("ffmpeg") ?? "/opt/homebrew/bin/ffmpeg";
export const FFPROBE = Bun.which("ffprobe") ?? "/opt/homebrew/bin/ffprobe";

/** ffmpeg with a progress callback (0..1) computed from `time=` against a known duration. */
export function ffmpeg(args: string[], opts: { duration?: number; onProgress?: (p: number) => void; signal?: AbortSignal } = {}) {
  return runOk([FFMPEG, "-hide_banner", "-y", ...args], {
    signal: opts.signal,
    onStderr: (s) => {
      if (!opts.duration || !opts.onProgress) return;
      const m = /time=(\d+):(\d+):([\d.]+)/.exec(s);
      if (m) opts.onProgress(Math.min(1, (+m[1]! * 3600 + +m[2]! * 60 + +m[3]!) / opts.duration));
    },
  });
}

export async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex").slice(0, 20);
}

export const sha256 = (s: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(s).digest("hex").slice(0, 20);
