import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import type { GenerateRequest, ModelInfo } from "@cezane/core";
import { counterName } from "./naming";
import { run, runOk } from "./proc";

/**
 * `out`: where the result lands, straight in the project's Générés/ folder as `<slug>-01.png`
 * (next free counter). `claim` is told the file name just before it appears, so a folder watcher
 * can tell the server's own writes from the user's.
 */
export type GenerateInput = GenerateRequest & {
  inputPaths: string[];
  workDir: string;
  out?: { dir: string; slug: string; claim?: (name: string) => void };
};
export type GenerateOutput = { file?: string; text?: string; costEur: number; model: string; provider: string };

type Provider = {
  id: string;
  models: () => Promise<ModelInfo[]>;
  run: (req: GenerateInput, onProgress: (p: number) => void, signal?: AbortSignal) => Promise<GenerateOutput>;
};

const falKey = async (): Promise<string | undefined> => {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const r = await run(["security", "find-generic-password", "-s", "cezane-fal", "-w"]);
  return r.code === 0 ? r.stdout.trim() : undefined;
};

// ───────────── Codex (image generation on the ChatGPT subscription) ─────────────

const codex: Provider = {
  id: "codex",
  models: async () => [
    {
      provider: "codex",
      id: "imagegen",
      label: "Codex · image",
      kind: "image",
      inputs: "images",
      costEur: 0,
      available: Boolean(Bun.which("codex")),
      note: "abonnement ChatGPT, ~1 min",
    },
  ],
  run: async (req, onProgress, signal) => {
    mkdirSync(req.workDir, { recursive: true });
    const out = join(req.workDir, "out.png");
    const refs = req.inputPaths.length ? ` Use the attached image(s) as references.` : "";
    const prompt = `Generate exactly one image with your image generation tool.${refs} Prompt: ${req.prompt}\n\nThen copy the generated PNG to ${out} (create nothing else) and reply "ok".`;
    const started = Date.now();
    const tick = setInterval(() => onProgress(Math.min(0.95, (Date.now() - started) / 90_000)), 1000);
    try {
      const args = ["codex", "exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", req.workDir, ...req.inputPaths.flatMap((p) => ["-i", p]), "--", prompt];
      const r = await run(args, { signal });
      if (!existsSync(out)) {
        // Fallback: the newest image Codex saved under ~/.codex/generated_images.
        const latest = newestImage(join(process.env.HOME ?? "", ".codex/generated_images"), started);
        if (!latest) throw new Error(`codex produced no image: ${r.stdout.slice(-300)}`);
        await Bun.write(out, Bun.file(latest));
      }
      return { file: out, costEur: 0, model: "imagegen", provider: "codex" };
    } finally {
      clearInterval(tick);
    }
  },
};

function newestImage(dir: string, since: number): string | undefined {
  if (!existsSync(dir)) return undefined;
  let best: { p: string; t: number } | undefined;
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(f) && s.mtimeMs >= since && (!best || s.mtimeMs > best.t)) best = { p, t: s.mtimeMs };
    }
  };
  walk(dir);
  return best?.p;
}

// ───────────── Claude (text: scripts, prompts) on the Claude subscription ─────────────

const claudeText: Provider = {
  id: "claude",
  models: async () =>
    ["haiku", "sonnet"].map((id) => ({
      provider: "claude",
      id,
      label: `Claude ${id[0]!.toUpperCase()}${id.slice(1)} · texte`,
      kind: "text" as const,
      inputs: "text" as const,
      costEur: 0,
      available: Boolean(Bun.which("claude")),
      note: "abonnement Claude",
    })),
  run: async (req, _p, signal) => {
    const r = await runOk(
      ["claude", "-p", "--model", req.model, "--output-format", "json", "--strict-mcp-config", "--max-turns", "1", "--system-prompt", "You write short, ready-to-use texts for video creators (scripts, hooks, prompts). Answer with the text only, in the language of the request.", req.prompt],
      { signal },
    );
    const j = JSON.parse(r.stdout) as { result?: string; total_cost_usd?: number };
    return { text: j.result?.trim() ?? "", costEur: 0, model: req.model, provider: "claude" };
  },
};

// ───────────── FAL (paid: images, image edit, video) ─────────────

const FAL_MODELS: (Omit<ModelInfo, "available" | "provider"> & { body: (req: GenerateInput, images: string[]) => Record<string, unknown> })[] = [
  { id: "fal-ai/flux/schnell", label: "FLUX schnell", kind: "image", inputs: "none", costEur: 0.003, body: (r) => ({ prompt: r.prompt, image_size: "portrait_16_9" }) },
  { id: "fal-ai/nano-banana/edit", label: "Nano Banana · édition", kind: "image", inputs: "images", costEur: 0.04, body: (r, imgs) => ({ prompt: r.prompt, image_urls: imgs }) },
  {
    id: "fal-ai/kling-video/v2.1/standard/image-to-video",
    label: "Kling 2.1 · image → vidéo 5 s",
    kind: "video",
    inputs: "images",
    costEur: 0.26,
    body: (r, imgs) => ({ prompt: r.prompt, image_url: imgs[0], duration: "5" }),
  },
];

const dataUri = async (path: string) => {
  const f = Bun.file(path);
  return `data:${f.type || "image/png"};base64,${Buffer.from(await f.arrayBuffer()).toString("base64")}`;
};

const fal: Provider = {
  id: "fal",
  models: async () => {
    const ok = Boolean(await falKey());
    return FAL_MODELS.map(({ body: _b, ...m }) => ({ ...m, provider: "fal", available: ok, note: ok ? undefined : "clé FAL manquante (trousseau « cezane-fal » ou FAL_KEY)" }));
  },
  run: async (req, onProgress, signal) => {
    const key = await falKey();
    if (!key) throw new Error("FAL key missing");
    const model = FAL_MODELS.find((m) => m.id === req.model);
    if (!model) throw new Error(`unknown FAL model ${req.model}`);
    const images = await Promise.all(req.inputPaths.map(dataUri));
    const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
    const sub = (await (await fetch(`https://queue.fal.run/${model.id}`, { method: "POST", headers, body: JSON.stringify(model.body(req, images)), signal })).json()) as {
      status_url: string;
      response_url: string;
    };
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = (await (await fetch(sub.status_url, { headers, signal })).json()) as { status: string };
      onProgress(Math.min(0.95, i / 60));
      if (st.status === "COMPLETED") break;
      if (i > 450) throw new Error("FAL timeout");
    }
    const res = (await (await fetch(sub.response_url, { headers, signal })).json()) as { images?: { url: string }[]; image?: { url: string }; video?: { url: string } };
    const url = res.video?.url ?? res.images?.[0]?.url ?? res.image?.url;
    if (!url) throw new Error("FAL returned no file");
    mkdirSync(req.workDir, { recursive: true });
    const ext = res.video ? "mp4" : (url.split("?")[0]!.split(".").pop() ?? "png");
    const file = join(req.workDir, `out.${ext}`);
    await Bun.write(file, await fetch(url, { signal }));
    return { file, costEur: model.costEur, model: model.id, provider: "fal" };
  },
};

export const providers: Provider[] = [codex, claudeText, fal];

export async function listModels(): Promise<ModelInfo[]> {
  return (await Promise.all(providers.map((p) => p.models()))).flat();
}

export async function generate(req: GenerateInput, onProgress: (p: number) => void, signal?: AbortSignal): Promise<GenerateOutput> {
  const p = providers.find((x) => x.id === req.provider);
  if (!p) throw new Error(`unknown provider ${req.provider}`);
  const r = await p.run(req, onProgress, signal);
  if (!r.file || !req.out) return r;
  // Straight into the project folder under a readable name; the work dir goes away.
  mkdirSync(req.out.dir, { recursive: true });
  const name = counterName(req.out.dir, req.out.slug, extname(r.file) || ".png");
  req.out.claim?.(name);
  const dest = join(req.out.dir, name);
  try {
    renameSync(r.file, dest);
  } catch {
    copyFileSync(r.file, dest);
    unlinkSync(r.file);
  }
  rmSync(req.workDir, { recursive: true, force: true });
  return { ...r, file: dest };
}
