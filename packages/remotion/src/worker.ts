// Long-lived render worker. JSON lines over stdin/stdout (WorkerRequest → WorkerResponse, see @cezane/core api.ts).
// Logs go to stderr only: stdout carries the protocol.
import { bundle } from "@remotion/bundler";
import { ensureBrowser, openBrowser, renderMedia, renderStill, selectComposition, type ChromiumOptions } from "@remotion/renderer";
import type { WorkerRequest, WorkerResponse } from "@cezane/core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "remotion/version";

for (const k of ["log", "info", "warn", "debug"] as const) console[k] = (...a: unknown[]) => console.error(...a);

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = dirname(here);
const coreSrc = join(pkgDir, "..", "core", "src");
const home = process.env.CEZANE_HOME ?? join(homedir(), "Cezane");
// Packaged app (see engine proc.ts PACKAGED): these sources sit in a signed, read-only bundle.
const packaged = existsSync(join(pkgDir, "..", "..", "cezane-runtime.json"));

if (packaged) {
  // Remotion downloads its headless Chrome to <nearest package.json from cwd>/node_modules/.remotion:
  // give it a folder of its own under ~/Cezane/cache instead of the bundle (or whatever the cwd is).
  const dir = join(home, "cache", "remotion");
  mkdirSync(dir, { recursive: true });
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) writeFileSync(pkg, `${JSON.stringify({ name: "cezane-remotion-cache", private: true }, null, 2)}\n`);
  process.chdir(dir);
}

const send = (msg: WorkerResponse) => process.stdout.write(`${JSON.stringify(msg)}\n`);

function hashTree(dirs: string[]): string {
  const h = createHash("sha256").update(VERSION);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|json|jpe?g|png|webp|woff2?)$/.test(e.name)) h.update(relative(pkgDir, p)).update(readFileSync(p));
    }
  };
  for (const d of dirs) walk(d);
  return h.digest("hex").slice(0, 16);
}

const chromiumOptions: ChromiumOptions = { gl: "angle" };
// 8-core M1 Pro, 16 GB: leave room for ffmpeg, the server and the Electron UI.
const concurrency = Math.max(2, Math.min(6, cpus().length - 2));

let bundled: { hash: string; dir: string } | null = null;
let bundling: Promise<string> | null = null;
let browser: Awaited<ReturnType<typeof openBrowser>> | null = null;

/** The bundle of the current sources: re-hashed on every request, so code edits apply without a restart. */
async function ensureBundle(force = false): Promise<string> {
  const hash = hashTree([here, coreSrc, join(pkgDir, "public")].filter((d) => existsSync(d)));
  if (!force && bundled?.hash === hash) return bundled.dir;
  bundling ??= (async () => {
    const outDir = join(home, "cache", "remotion-bundle", hash);
    if (force || !existsSync(join(outDir, "index.html"))) {
      mkdirSync(dirname(outDir), { recursive: true });
      const t = Date.now();
      // No webpack cache when packaged: it would go to <rootDir>/node_modules/.cache, inside the bundle.
      await bundle({ entryPoint: join(here, "index.ts"), outDir, rootDir: pkgDir, enableCaching: !packaged, onProgress: () => {} });
      console.error(`[remotion-worker] bundled in ${Date.now() - t} ms → ${outDir}`);
    }
    bundled = { hash, dir: outDir };
    return outDir;
  })().finally(() => {
    bundling = null;
  });
  return bundling;
}

/** Remotion's headless Chrome, downloaded on first use (~100 MB); `onProgress` gets 0..1 while it downloads. */
async function ensureChrome(onProgress?: (p: number) => void) {
  let last = -1;
  return ensureBrowser({
    logLevel: "error",
    onBrowserDownload: () => {
      console.error("[remotion-worker] downloading the headless Chrome (first render)…");
      return {
        version: null,
        onProgress: ({ percent }) => {
          if (percent - last >= 0.02 || percent === 1) {
            last = percent;
            onProgress?.(percent);
          }
        },
      };
    },
  });
}

async function getBrowser() {
  if (!browser) {
    await ensureChrome();
    browser = await openBrowser("chrome", { chromiumOptions, logLevel: "error" });
  }
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
    case "browser": {
      const status = await ensureChrome((progress) => send({ id: req.id, progress }));
      return { path: "path" in status ? status.path : undefined, ms: Date.now() - t };
    }
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
/** Closes Chrome before leaving: a killed worker must not leave its browser running. */
async function shutdown() {
  const timeout = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await Promise.race([chain, timeout(3000)]);
  await Promise.race([browser?.close({ silent: true }).catch(() => {}), timeout(2000)]);
  process.exit(0);
}
process.stdin.on("end", () => void shutdown());
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => void shutdown());
