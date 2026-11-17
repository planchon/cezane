import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { renderLog } from "./renderlog";

export const CEZANE_HOME = process.env.CEZANE_HOME ?? join(homedir(), "Cezane");
export const CACHE_DIR = join(CEZANE_HOME, "cache");
export const LIBRARY_DIR = join(CEZANE_HOME, "library");
export const MODELS_DIR = join(CEZANE_HOME, "models");
/** The checkout in dev, or Cezane.app/Contents/Resources/app/runtime in the packaged app (same layout). */
export const REPO_DIR = join(import.meta.dir, "../../..");
/**
 * Packaged app (scripts/release-mac.ts writes this marker): REPO_DIR is inside a signed, read-only
 * bundle, so nothing may be written there (caches, builds, downloads go to CEZANE_HOME/cache).
 */
export const PACKAGED = existsSync(join(REPO_DIR, "cezane-runtime.json"));

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
  // During a render, the command and its stderr go to the render log (complete lines only).
  const log = renderLog();
  let pending = "";
  const toLog = (s: string) => {
    pending += s;
    const i = pending.lastIndexOf("\n");
    if (i >= 0) {
      log!.line(pending.slice(0, i));
      pending = pending.slice(i + 1);
    } else if (pending.length > 4000) pending = pending.slice(pending.lastIndexOf("\r") + 1);
  };
  if (log) {
    const line = cmd.map((a) => (/^[\w./:=,+-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(" ");
    log.line(`$ ${line.length > 600 ? `${line.slice(0, 600)}…` : line}`);
  }
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
  const onStderr = log
    ? (s: string) => {
        toLog(s);
        opts.onStderr?.(s);
      }
    : opts.onStderr;
  const [stdout, stderr] = await Promise.all([read(proc.stdout, opts.onStdout), read(proc.stderr, onStderr)]);
  const code = await proc.exited;
  if (log) {
    if (pending.trim()) log.line(pending);
    if (code !== 0) log.line(`→ ${cmd[0]?.split("/").at(-1)} a échoué (code ${code})`);
  }
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
