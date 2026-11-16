// Long-lived render worker. JSON lines over stdin/stdout (WorkerRequest → WorkerResponse, see @cezane/core api.ts).
// Logs go to stderr only: stdout carries the protocol.
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, renderStill, selectComposition, type ChromiumOptions } from "@remotion/renderer";
import type { WorkerRequest, WorkerResponse } from "@cezane/core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "remotion/version";

for (const k of ["log", "info", "warn", "debug"] as const) console[k] = (...a: unknown[]) => console.error(...a);

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = dirname(here);
const coreSrc = join(pkgDir, "..", "core", "src");

const send = (msg: WorkerResponse) => process.stdout.write(`${JSON.stringify(msg)}\n`);

function hashTree(dirs: string[]): string {
  const h = createHash("sha256").update(VERSION);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|json)$/.test(e.name)) h.update(relative(pkgDir, p)).update(readFileSync(p));
    }
  };
  for (const d of dirs) walk(d);
  return h.digest("hex").slice(0, 16);
}

const chromiumOptions: ChromiumOptions = { gl: "angle" };
// 8-core M1 Pro, 16 GB: leave room for ffmpeg, the server and the Electron UI.
const concurrency = Math.max(2, Math.min(6, cpus().length - 2));

let serveUrl: string | null = null;
let browser: Awaited<ReturnType<typeof openBrowser>> | null = null;

async function ensureBundle(force = false): Promise<string> {
  if (serveUrl && !force) return serveUrl;
  const outDir = join(homedir(), "Cezane", "cache", "remotion-bundle", hashTree([here, coreSrc]));
  if (force || !existsSync(join(outDir, "index.html"))) {
    mkdirSync(dirname(outDir), { recursive: true });
    const t = Date.now();
    await bundle({ entryPoint: join(here, "index.ts"), outDir, rootDir: pkgDir, enableCaching: true, onProgress: () => {} });
    console.error(`[remotion-worker] bundled in ${Date.now() - t} ms → ${outDir}`);
  }
  serveUrl = outDir;
  return outDir;
}

async function getBrowser() {
  browser ??= await openBrowser("chrome", { chromiumOptions, logLevel: "error" });
  return browser;
}

async function composition(id: string, inputProps: Record<string, unknown>) {
  return selectComposition({ serveUrl: await ensureBundle(), id, inputProps, puppeteerInstance: await getBrowser(), chromiumOptions, logLevel: "error" });
}

async function still(id: string, inputProps: Record<string, unknown>, frame: number, out: string, scale = 1) {
  const comp = await composition(id, inputProps);
  mkdirSync(dirname(out), { recursive: true });
  await renderStill({
    serveUrl: await ensureBundle(),
    composition: comp,
    inputProps,
    frame: Math.min(Math.max(0, frame), comp.durationInFrames - 1),
    output: out,
    imageFormat: "jpeg",
    jpegQuality: 85,
    scale,
    puppeteerInstance: await getBrowser(),
    chromiumOptions,
    overwrite: true,
    logLevel: "error",
  });
}

async function handle(req: WorkerRequest): Promise<unknown> {
  const t = Date.now();
  switch (req.cmd) {
    case "bundle":
      return { serveUrl: await ensureBundle(req.args.force), ms: Date.now() - t };
    case "segment": {
      const { props, start, end, out } = req.args;
      const inputProps = props as unknown as Record<string, unknown>;
      const comp = await composition("Timeline", inputProps);
      mkdirSync(dirname(out), { recursive: true });
      let last = 0;
      await renderMedia({
        serveUrl: await ensureBundle(),
        composition: comp,
        inputProps,
        codec: "h264",
        outputLocation: out,
        frameRange: [start, end - 1],
        muted: true,
        enforceAudioTrack: false,
        imageFormat: "jpeg",
        jpegQuality: 90,
        // Same encoder settings for every segment, so ffmpeg can join them with `-c copy`.
        crf: 18,
        x264Preset: "veryfast",
        pixelFormat: "yuv420p",
        colorSpace: "bt709",
        concurrency,
        puppeteerInstance: await getBrowser(),
        chromiumOptions,
        overwrite: true,
        logLevel: "error",
        onProgress: ({ progress }) => {
          if (progress - last >= 0.05 || progress === 1) {
            last = progress;
            send({ id: req.id, progress });
          }
        },
      });
      return { out, frames: end - start, ms: Date.now() - t };
    }
    case "still":
      await still("Timeline", req.args.props as unknown as Record<string, unknown>, req.args.frame, req.args.out, req.args.scale);
      return { out: req.args.out, ms: Date.now() - t };
    case "look":
      await still("Look", req.args.props as unknown as Record<string, unknown>, 0, req.args.out);
      return { out: req.args.out, ms: Date.now() - t };
    case "graphicStill":
      await still("GraphicPreview", { component: req.args.component, props: req.args.props }, req.args.frame, req.args.out);
      return { out: req.args.out, ms: Date.now() - t };
  }
}

let chain: Promise<void> = Promise.resolve();

function onLine(line: string) {
  if (!line.trim()) return;
  let req: WorkerRequest;
  try {
    req = JSON.parse(line) as WorkerRequest;
  } catch {
    console.error("[remotion-worker] bad request line");
    return;
  }
  // One job at a time: renders are heavy on a 16 GB machine.
  chain = chain.then(async () => {
    try {
      send({ id: req.id, ok: true, result: await handle(req) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (/browser|target closed|protocol error|session closed/i.test(error)) browser = null;
      send({ id: req.id, ok: false, error });
    }
  });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl = buffer.indexOf("\n");
  while (nl >= 0) {
    onLine(buffer.slice(0, nl));
    buffer = buffer.slice(nl + 1);
    nl = buffer.indexOf("\n");
  }
});
process.stdin.on("end", async () => {
  await chain;
  await browser?.close({ silent: true }).catch(() => {});
  process.exit(0);
});
