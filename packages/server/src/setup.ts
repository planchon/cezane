// « Préparer Cezane »: checks the tools Cezane relies on (Homebrew ffmpeg and whisper.cpp, the
// whisper model, Claude Code; optionally Codex, Google Chrome, Xcode) and downloads what it can
// itself: the whisper model into ~/Cezane/models, Remotion's headless Chrome into ~/Cezane/cache.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SetupDownload, SetupItem, SetupState } from "@cezane/core";
import { CACHE_DIR, MODELS_DIR, PACKAGED, REPO_DIR, type RenderWorker, WHISPER_MODEL_FILE } from "@cezane/engine";

/** The model from the official whisper.cpp repository, checked against its LFS sha256 and size. */
export const WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}`;
const MODEL_SHA256 = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2";
const MODEL_SIZE = 574_041_195;

/** ffmpeg filters and encoders the engine uses (audio cleanup, loudness, LUTs, silences, cutouts). */
const FFMPEG_FILTERS = ["arnndn", "afftdn", "loudnorm", "ebur128", "lut3d", "silencedetect"];
const FFMPEG_ENCODERS = ["h264_videotoolbox", "libvpx-vp9", "aac"];
const CHROME_APP = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const mb = (n: number) => `${Math.round(n / 1e6)} Mo`;

/** Where a command lives: the server's PATH, then where Homebrew and the Claude installer put things. */
function find(name: string): string | undefined {
  const found = Bun.which(name);
  if (found) return found;
  return [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, join(homedir(), ".local/bin", name)].find((p) => existsSync(p));
}

/** Runs a command quickly (a hung tool must not hang the check). */
async function out(cmd: string[], timeoutMs = 8000): Promise<{ code: number; text: string }> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(timer);
    return { code, text: `${o}\n${e}` };
  } catch (err) {
    return { code: -1, text: String(err) };
  }
}

/** Remotion's headless Chrome folder (see remotion worker.ts: ~/Cezane/cache/remotion when packaged). */
function rendererDir(): string {
  return PACKAGED ? join(CACHE_DIR, "remotion/node_modules/.remotion/chrome-headless-shell") : join(REPO_DIR, "node_modules/.remotion/chrome-headless-shell");
}

const idle = (): SetupDownload => ({ state: "idle", received: 0, total: 0 });

export class Setup {
  readonly modelPath: string;
  model: SetupDownload = idle();
  renderer: SetupDownload = idle();
  private abort?: AbortController;
  private last?: { at: number; items: SetupItem[] };

  constructor(
    private worker: RenderWorker,
    /** `model`: another source for the whisper model (tests): its URL, sha256 and size. */
    readonly opts: { modelsDir?: string; model?: { url: string; sha256: string; size: number } } = {},
  ) {
    this.modelPath = join(opts.modelsDir ?? MODELS_DIR, WHISPER_MODEL_FILE);
  }

  /** The checks (cached 30 s unless `fresh`), with the downloads' live progress. */
  async state(fresh = false): Promise<SetupState> {
    if (fresh || !this.last || Date.now() - this.last.at > 30_000) this.last = { at: Date.now(), items: await this.check() };
    const items = this.last.items.map((i) => (i.id === "model" ? this.modelItem() : i.id === "renderer" ? this.rendererItem() : i));
    return { ready: items.every((i) => i.need !== "required" || i.ok), checkedAt: new Date(this.last.at).toISOString(), items, commands: commands(items) };
  }

  private async check(): Promise<SetupItem[]> {
    const [ffmpeg, ffprobe, whisper, claude, codex, simulator] = await Promise.all([
      this.ffmpeg(),
      tool("ffprobe", "ffprobe", ["-hide_banner", "-version"], /ffprobe version (\S+)/),
      tool("whisper", "whisper-cli", ["--version"], /version:?\s*(\S+)/i),
      tool("claude", "claude", ["--version"], /^\s*(\S+)/),
      tool("codex", "codex", ["--version"], /(\d+\.\d+\.\d+\S*)/),
      this.simulator(),
    ]);
    const chrome = existsSync(CHROME_APP);
    return [
      { ...ffmpeg, label: "ffmpeg", need: "required" },
      { ...ffprobe, label: "ffprobe", need: "required" },
      { ...whisper, label: "whisper-cli", need: "required", detail: whisper.ok ? `whisper.cpp ${whisper.detail}` : whisper.detail },
      this.modelItem(),
      { ...claude, label: "Claude Code", need: "required" },
      this.rendererItem(),
      { ...codex, label: "Codex", need: "optional", unlocks: "Images générées avec ton abonnement ChatGPT" },
      { id: "chrome", label: "Google Chrome", need: "optional", ok: chrome, detail: chrome ? "installé" : "absent", unlocks: "Captures de pages web" },
      { ...simulator, label: "Simulateur iOS", need: "optional", unlocks: "Captures d'apps iOS" },
    ];
  }

  private async ffmpeg(): Promise<Pick<SetupItem, "id" | "ok" | "detail">> {
    const bin = find("ffmpeg");
    if (!bin) return { id: "ffmpeg", ok: false, detail: "introuvable" };
    const [v, f, e] = await Promise.all([out([bin, "-hide_banner", "-version"]), out([bin, "-hide_banner", "-filters"]), out([bin, "-hide_banner", "-encoders"])]);
    const version = /ffmpeg version (\S+)/.exec(v.text)?.[1] ?? "?";
    const has = (list: string, name: string) => new RegExp(`\\s${name}\\s`).test(list);
    const missing = [...FFMPEG_FILTERS.filter((x) => !has(f.text, x)), ...FFMPEG_ENCODERS.filter((x) => !has(e.text, x))];
    return missing.length ? { id: "ffmpeg", ok: false, detail: `${version}, sans ${missing.join(", ")}` } : { id: "ffmpeg", ok: true, detail: version };
  }

  /** simctl comes with Xcode only. Never call xcrun without developer tools: macOS would offer to install them. */
  private async simulator(): Promise<Pick<SetupItem, "id" | "ok" | "detail">> {
    const dev = await out(["/usr/bin/xcode-select", "-p"], 4000);
    const path = dev.text.trim();
    if (dev.code !== 0 || !path || path.includes("CommandLineTools")) return { id: "simulator", ok: false, detail: "Xcode absent" };
    const simctl = await out(["/usr/bin/xcrun", "--find", "simctl"], 8000);
    return simctl.code === 0 ? { id: "simulator", ok: true, detail: "Xcode installé" } : { id: "simulator", ok: false, detail: "simctl introuvable" };
  }

  private modelItem(): SetupItem {
    const expected = this.opts.model?.size ?? MODEL_SIZE;
    const size = existsSync(this.modelPath) ? statSync(this.modelPath).size : 0;
    const ok = size === expected;
    const detail = ok ? `large-v3-turbo · ${mb(size)}` : size ? `fichier incomplet (${mb(size)})` : `large-v3-turbo · ${mb(expected)} à télécharger`;
    return { id: "model", label: "Modèle de transcription", need: "required", ok, detail, download: { ...this.model } };
  }

  private rendererItem(): SetupItem {
    const dir = rendererDir();
    const version = join(dir, "VERSION");
    const ok = existsSync(version);
    const detail = ok ? `Chrome headless ${readFileSync(version, "utf8").trim().split("-")[0]}` : "téléchargé au premier rendu (~100 Mo)";
    return { id: "renderer", label: "Moteur de rendu", need: "auto", ok, detail, download: { ...this.renderer } };
  }

  // ───── downloads ─────

  /** Downloads the whisper model to a temporary name, checks size and sha256, then renames it. */
  downloadModel() {
    if (this.model.state === "running") return;
    const { url, sha256: expected, size } = this.opts.model ?? { url: WHISPER_MODEL_URL, sha256: MODEL_SHA256, size: MODEL_SIZE };
    const tmp = `${this.modelPath}.download`;
    const abort = new AbortController();
    this.abort = abort;
    this.model = { state: "running", received: 0, total: size };
    const run = async () => {
      mkdirSync(dirname(this.modelPath), { recursive: true });
      const res = await fetch(url, { signal: abort.signal, redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`téléchargement refusé (${res.status})`);
      const total = Number(res.headers.get("content-length")) || size;
      this.model.total = total;
      const hasher = new Bun.CryptoHasher("sha256");
      const sink = Bun.file(tmp).writer({ highWaterMark: 4 << 20 });
      try {
        for await (const chunk of res.body) {
          hasher.update(chunk);
          sink.write(chunk);
          this.model.received += chunk.byteLength;
        }
      } finally {
        await sink.end();
      }
      const sha = hasher.digest("hex");
      if (this.model.received !== size || sha !== expected) throw new Error(`fichier corrompu (${mb(this.model.received)}, sha256 ${sha.slice(0, 12)}…)`);
      renameSync(tmp, this.modelPath);
      this.model = { state: "done", received: this.model.received, total };
    };
    run().catch((e: unknown) => {
      rmSync(tmp, { force: true });
      this.model = abort.signal.aborted ? idle() : { ...this.model, state: "error", error: e instanceof Error ? e.message : String(e) };
    });
  }

  cancelModel() {
    this.abort?.abort();
  }

  /** Downloads Remotion's headless Chrome now through the render worker (else the first render does). */
  downloadRenderer() {
    if (this.renderer.state === "running") return;
    this.renderer = { state: "running", received: 0, total: 1 };
    this.worker
      .request("browser", {}, (p) => {
        this.renderer.received = p;
      })
      .then(
        () => (this.renderer = { state: "done", received: 1, total: 1 }),
        (e: unknown) => (this.renderer = { state: "error", received: 0, total: 1, error: e instanceof Error ? e.message : String(e) }),
      );
  }
}

/** A command-line tool: found, and its version (from `args`). */
async function tool(id: SetupItem["id"], name: string, args: string[], version: RegExp): Promise<Pick<SetupItem, "id" | "ok" | "detail">> {
  const bin = find(name);
  if (!bin) return { id, ok: false, detail: "introuvable" };
  const r = await out([bin, ...args]);
  // An older build without --version still prints its usage: it runs.
  if (r.code !== 0 && !/usage|options/i.test(r.text)) return { id, ok: false, detail: `ne démarre pas (${bin})` };
  return { id, ok: true, detail: version.exec(r.text)?.[1] ?? "installé" };
}

/** Terminal commands for what is missing, in the order to run them. */
export function commands(items: SetupItem[]): SetupState["commands"] {
  const missing = (id: SetupItem["id"]) => items.some((i) => i.id === id && !i.ok);
  const cmds: SetupState["commands"] = [];
  const formulae = [missing("ffmpeg") || missing("ffprobe") ? "ffmpeg" : "", missing("whisper") ? "whisper-cpp" : ""].filter(Boolean);
  if (formulae.length) {
    if (!find("brew")) cmds.push({ label: "Homebrew", command: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' });
    cmds.push({ label: "Outils vidéo", command: `brew install ${formulae.join(" ")}` });
  }
  if (missing("claude")) {
    cmds.push({ label: "Claude Code", command: "curl -fsSL https://claude.ai/install.sh | bash" });
    cmds.push({ label: "Connexion à Claude", command: "claude" });
  }
  return cmds;
}
