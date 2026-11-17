import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SetupItem } from "@cezane/core";
import { RenderWorker } from "@cezane/engine";
import { tempDir, until } from "../test/helpers";
import { startHttp } from "./http";
import { Hub } from "./hub";
import { commands, Setup } from "./setup";

// A fake model served locally: the download goes to <name>.download, is checked, then renamed.
const body = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
const sha256 = new Bun.CryptoHasher("sha256").update(body).digest("hex");
let server: ReturnType<typeof Bun.serve>;
const t = tempDir();

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: (req) => (new URL(req.url).pathname === "/model.bin" ? new Response(body) : new Response("nope", { status: 404 })) });
});
afterAll(() => {
  server.stop(true);
  t.cleanup();
});

const item = (s: Awaited<ReturnType<Setup["state"]>>, id: SetupItem["id"]) => s.items.find((i) => i.id === id)!;

describe("setup", () => {
  test("downloads the model to a temporary name, checks it, then renames it", async () => {
    const modelsDir = join(t.dir, "ok/models");
    const setup = new Setup(new RenderWorker(), { modelsDir, model: { url: `${server.url}model.bin`, sha256, size: body.length } });
    expect(item(await setup.state(true), "model").ok).toBe(false);
    setup.downloadModel();
    await until(() => setup.model.state !== "running", 10_000, "download");
    expect(setup.model.state).toBe("done");
    expect(readdirSync(modelsDir)).toEqual([setup.modelPath.split("/").at(-1)!]);
    const s = await setup.state(true);
    expect(item(s, "model").ok).toBe(true);
  });

  test("a corrupt download leaves nothing behind and says so", async () => {
    const modelsDir = join(t.dir, "bad/models");
    const setup = new Setup(new RenderWorker(), { modelsDir, model: { url: `${server.url}model.bin`, sha256: "0".repeat(64), size: body.length } });
    setup.downloadModel();
    await until(() => setup.model.state !== "running", 10_000, "download");
    expect(setup.model.state).toBe("error");
    expect(setup.model.error).toContain("corrompu");
    expect(readdirSync(modelsDir)).toEqual([]);
  });

  test("an incomplete model file is not ok", async () => {
    const modelsDir = join(t.dir, "partial/models");
    mkdirSync(modelsDir, { recursive: true });
    const setup = new Setup(new RenderWorker(), { modelsDir, model: { url: `${server.url}model.bin`, sha256, size: body.length } });
    writeFileSync(setup.modelPath, body.slice(0, 1000));
    const m = item(await setup.state(true), "model");
    expect(m.ok).toBe(false);
    expect(m.detail).toContain("incomplet");
    expect(existsSync(`${setup.modelPath}.download`)).toBe(false);
  });

  test("Terminal commands for what is missing, in order", () => {
    const items = (missing: SetupItem["id"][]): SetupItem[] =>
      (["ffmpeg", "ffprobe", "whisper", "model", "claude"] as const).map((id) => ({ id, label: id, need: "required", ok: !missing.includes(id), detail: "" }));
    expect(commands(items([])).length).toBe(0);
    expect(commands(items(["whisper"])).map((c) => c.command)).toContain("brew install whisper-cpp");
    const all = commands(items(["ffmpeg", "whisper", "claude"])).map((c) => c.command);
    expect(all).toContain("brew install ffmpeg whisper-cpp");
    expect(all.slice(-2)).toEqual(["curl -fsSL https://claude.ai/install.sh | bash", "claude"]);
    // The model is downloaded by Cezane itself: no command for it.
    expect(commands(items(["model"])).length).toBe(0);
  });
});

describe("first launch (no project)", () => {
  test("the unscoped routes answer 404 instead of creating a project; setup and jobs answer", async () => {
    const port = 49_000 + Math.floor(Math.random() * 900);
    const hub = new Hub({ port, home: join(t.dir, "first/Cezane"), demos: false, watch: false });
    const server = startHttp(hub, port);
    try {
      const base = `http://127.0.0.1:${port}`;
      expect((await fetch(`${base}/api/jobs`)).status).toBe(200);
      expect((await fetch(`${base}/api/state`)).status).toBe(404);
      expect((await fetch(`${base}/api/setup`)).status).toBe(200);
      expect(await (await fetch(`${base}/api/projects`)).json()).toEqual([]);
    } finally {
      server.stop(true);
      await hub.stop();
    }
  });
});
