import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Asset, Montage, ServerState, Version } from "@cezane/core";
import { CACHE_DIR, ffmpeg, RenderLog, RenderWorker, renderLog, withRenderLog } from "@cezane/engine";
import { tempDir, until } from "../test/helpers";
import { Cezane } from "./app";
import { checkAssets, classifyFailure, RenderFailureError, repairPrompt } from "./failures";
import { startHttp } from "./http";
import { Hub } from "./hub";
import { ProjectStore } from "./store";

const t = tempDir("cezane-failures-");

let n = 0;
/** An asset whose original file and cache entry this test controls. */
function fakeAsset(over: Partial<Asset> = {}): Asset {
  n += 1;
  return {
    id: `a_test${n}`,
    kind: "video",
    name: `plage ${n}`,
    hash: `testhash${Date.now()}${n}`,
    file: `Rushes/plage ${n}.mov`,
    duration: 4,
    width: 1080,
    height: 1920,
    fps: 30,
    hasAudio: false,
    provenance: { type: "import", path: "/x" },
    derived: { normalized: "normalized.mp4" },
    status: "ready",
    tags: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}
const montageWith = (assetId: string): Montage =>
  ({
    id: "m1",
    name: "M",
    settings: { width: 1080, height: 1920, fps: 30 },
    tracks: [{ id: "t_main", kind: "video", name: "Main", clips: [{ id: "c1", type: "media", assetId, start: 0, duration: 30 }] }],
  }) as unknown as Montage;

describe("classification", () => {
  test("missing: the render reported it, or a used file is gone with its cache", () => {
    const e = new RenderFailureError("missing", "Fichier introuvable : plage.mov", ["a1"]);
    expect(classifyFailure({ error: e })).toMatchObject({ kind: "missing", assetIds: ["a1"] });
    const f = classifyFailure({ error: new Error("Remotion: 404 on /files/cache/x/normalized.mp4"), missing: [{ id: "a2", file: "Rushes/Jour 1/mer.mov" }] });
    expect(f).toMatchObject({ kind: "missing", assetIds: ["a2"], message: "Fichier introuvable : mer.mov" });
  });

  test("interrupted: a restart, or a render cancelled before it ran", () => {
    expect(classifyFailure({ error: "interrupted" }).kind).toBe("interrupted");
    expect(classifyFailure({ error: new RenderFailureError("interrupted", "cancelled") }).kind).toBe("interrupted");
    expect(classifyFailure({ error: new Error("x"), interrupted: true }).kind).toBe("interrupted");
  });

  test("technical: anything else, transient when it looks like it may pass", () => {
    const f = classifyFailure({ error: new Error("ffmpeg failed (1): Invalid data found when processing input"), logTail: "$ ffmpeg …" });
    expect(f).toMatchObject({ kind: "technical", message: "ffmpeg failed (1): Invalid data found when processing input", logTail: "$ ffmpeg …" });
    expect(f.transient).toBeUndefined();
    expect(classifyFailure({ error: new Error("render worker exited (null)") }).transient).toBe(true);
    expect(classifyFailure({ error: new Error("boom"), logTail: "Navigation timeout of 30000 ms exceeded" }).transient).toBe(true);
  });

  test("checkAssets: renders read the cache; a file is missing only when its cache is gone too", () => {
    const dir = join(t.dir, "check");
    mkdirSync(join(dir, "Rushes"), { recursive: true });
    const cached = fakeAsset();
    mkdirSync(join(CACHE_DIR, cached.hash), { recursive: true });
    writeFileSync(join(CACHE_DIR, cached.hash, "normalized.mp4"), "x");
    const original = fakeAsset();
    writeFileSync(join(dir, original.file), "x");
    const gone = fakeAsset();
    const unused = fakeAsset();
    const m = montageWith(cached.id);
    m.tracks[0]!.clips.push({ ...m.tracks[0]!.clips[0]!, id: "c2", assetId: original.id } as never, { ...m.tracks[0]!.clips[0]!, id: "c3", assetId: gone.id } as never);
    const r = checkAssets(m, [cached, original, gone, unused], dir);
    expect(r.missing.map((a) => a.id)).toEqual([gone.id]);
    expect(r.stale.map((a) => a.id)).toEqual([original.id]);
  });

  test("the repair prompt carries the error, the log and the instructions", () => {
    const v = { id: "v7", n: 3, revision: 4 } as Version;
    const p = repairPrompt({ version: v, failure: { kind: "technical", message: "LUT not found: drame2" }, log: "$ ffmpeg -i x\nboom", revisionNow: 5 });
    expect(p).toContain("V3 (v7)");
    expect(p).toContain("LUT not found: drame2");
    expect(p).toContain("boom");
    expect(p).toContain("revision 4");
    expect(p).toContain("Do not call `render`");
  });
});

describe("render log", () => {
  test("commands run during a render write their stderr to its log, without ffmpeg progress", async () => {
    const file = join(t.dir, "log", "v1.log");
    const log = new RenderLog(file);
    await withRenderLog(log, async () => {
      expect(renderLog()).toBe(log);
      await ffmpeg(["-i", "/nonexistent/cezane-test.mov", "-f", "null", "-"]).catch(() => undefined);
    });
    expect(renderLog()).toBeUndefined();
    log.flush();
    const text = readFileSync(file, "utf8");
    expect(text).toContain("$ ");
    expect(text).toContain("/nonexistent/cezane-test.mov");
    expect(text).toMatch(/No such file|does not exist/);
    log.line("frame=  120 fps= 60 q=-1.0 size=  1kB time=00:00:04.00 bitrate= 1kbits/s speed=2x\rframe=  121 fps= 60 time=00:00:04.03 speed=2x");
    expect(log.all()).not.toContain("frame=");
  });

  test("store: a render cut by a restart is interrupted; old failures get a kind", () => {
    const store = ProjectStore.init(join(t.dir, "legacy"), "Legacy");
    const base = { montageId: store.activeId, revision: 0, author: "user", summary: "", progress: 0, montageFile: "x.json", durationFrames: 30, fps: 30, createdAt: new Date().toISOString() };
    writeFileSync(store.path(".cezane/renders/v1.log"), "Rendu V1\n[remotion] segment 0–30\n");
    writeFileSync(
      store.path("versions.json"),
      JSON.stringify([
        { ...base, id: "v1", n: 1, status: "rendering" },
        { ...base, id: "v2", n: 2, status: "error", error: "ffmpeg failed (1): x" },
      ]),
    );
    const s = new ProjectStore(store.dir).load();
    expect(s.versions[0]).toMatchObject({ status: "error", failure: { kind: "interrupted", logTail: "Rendu V1\n[remotion] segment 0–30" } });
    expect(s.versions[1]!.failure).toMatchObject({ kind: "technical", message: "ffmpeg failed (1): x" });
  });
});

/** A render worker that fails the way a test wants (it never starts Remotion). */
class FakeWorker extends RenderWorker {
  mode: "ffmpeg" | "crash" | "gate" = "ffmpeg";
  gate = Promise.withResolvers<void>();
  override async request(cmd: string): Promise<unknown> {
    renderLog()?.line(`[remotion] ${cmd} (fake)`);
    if (this.mode === "crash") throw new Error("render worker exited (null)");
    if (this.mode === "gate") {
      await this.gate.promise;
      throw new Error("boom after the gate");
    }
    await ffmpeg(["-i", "/nonexistent/segment-input.mov", "-f", "null", "-"]);
    return null;
  }
}

describe("routes", () => {
  const port = 49_000 + Math.floor(Math.random() * 2000);
  const base = `http://127.0.0.1:${port}`;
  const worker = new FakeWorker();
  let hub: Hub;
  let server: ReturnType<typeof startHttp>;
  let app: Cezane;
  let pid: string;
  const oldPath = process.env.PATH;
  const claudeArgs = join(t.dir, "claude-args.txt");

  const call = async <T>(method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/api/p/${pid}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, data: (r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) as T };
  };
  const version = (id: string) => app.store.versions.find((v) => v.id === id)!;
  const settled = (id: string) => until(() => version(id).status !== "rendering" && version(id), 10_000, `${id} settled`);

  beforeAll(() => {
    // A fake `claude`: records its arguments, says one thing, ends well (no real Claude turn).
    const bin = join(t.dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "claude"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${claudeArgs}'\nsleep 0.4\necho '{"type":"assistant","message":{"content":[{"type":"text","text":"Le montage n est pas en cause."}]}}'\necho '{"type":"result","is_error":false,"result":"ok"}'\n`,
    );
    chmodSync(join(bin, "claude"), 0o755);
    process.env.PATH = `${bin}:${oldPath}`;
    Cezane.revealCommand = ["true"];
    hub = new Hub({ port, home: join(t.dir, "Cezane"), demos: false, watch: false, worker });
    server = startHttp(hub, port);
    pid = hub.create("Échecs").id;
    app = hub.get(pid);
  });
  afterAll(async () => {
    process.env.PATH = oldPath;
    server.stop(true);
    await hub.stop();
    t.cleanup();
  });

  test("a used file gone with its cache: missing, with the asset; remove-clips takes its clips out", async () => {
    const a = fakeAsset({ missing: true });
    app.store.project.assets.push(a);
    app.store.saveProject();
    expect((await call("POST", "/edit", { ops: [{ op: "add_clip", track: "t_main", clip: { type: "media", assetId: a.id, start: 0, duration: 30 } }] })).status).toBe(200);
    const v = (await call<Version>("POST", "/render", {})).data;
    const done = await settled(v.id);
    expect(done.status).toBe("error");
    expect(done.failure).toMatchObject({ kind: "missing", assetIds: [a.id], message: `Fichier introuvable : ${a.file.split("/").at(-1)}` });
    expect(done.error).toBe(done.failure!.message);
    const log = (await call<string>("GET", `/versions/${v.id}/log`)).data;
    expect(log).toContain(`Rendu V${v.n}`);
    expect(log).toContain("Fichier introuvable");

    const r = await call<{ removed: number; revision: number }>("POST", `/versions/${v.id}/remove-clips`, {});
    expect(r.data.removed).toBe(1);
    const st = (await call<ServerState>("GET", "/state")).data;
    expect(st.montage.tracks.find((x) => x.id === "t_main")!.clips).toHaveLength(0);
    expect(st.revision).toBe(r.data.revision);
    expect((await call<{ removed: number }>("POST", `/versions/${v.id}/remove-clips`, {})).data.removed).toBe(0);
  });

  test("an ffmpeg error: technical, with the log tail; retry renders the same version again", async () => {
    await call("POST", "/edit", { ops: [{ op: "add_clip", track: "t_gfx", clip: { type: "graphic", component: "Title", start: 0, duration: 30, props: { text: "Bonjour" } } }] });
    worker.mode = "ffmpeg";
    const v = (await call<Version>("POST", "/render", {})).data;
    const done = await settled(v.id);
    expect(done.failure!.kind).toBe("technical");
    expect(done.failure!.message).toContain("ffmpeg failed");
    expect(done.failure!.transient).toBeUndefined();
    expect(done.failure!.logTail).toContain("[remotion] segment (fake)");
    expect(done.failure!.logTail).toContain("segment-input.mov");
    expect(existsSync(app.store.path(".cezane/renders", `${v.id}.log`))).toBe(true);

    const count = app.store.versions.length;
    worker.mode = "crash";
    const again = await call<Version>("POST", `/versions/${v.id}/retry`);
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ id: v.id, n: v.n, status: "rendering" });
    expect(again.data.failure).toBeUndefined();
    const second = await settled(v.id);
    expect(app.store.versions.length).toBe(count);
    expect(second.failure).toMatchObject({ kind: "technical", transient: true, message: "render worker exited (null)" });
    // Only a failed version can be retried or repaired.
    expect((await call("POST", "/versions/v999/retry")).status).toBe(404);
  });

  test("a render cancelled before it ran (project closing) is interrupted", async () => {
    worker.mode = "gate";
    worker.gate = Promise.withResolvers<void>();
    const first = (await call<Version>("POST", "/render", {})).data;
    const queued = (await call<Version>("POST", "/render", {})).data; // one render per project at a time: queued
    await until(() => app.jobs.list.some((j) => j.status === "queued"), 5000, "queued render");
    hub.scheduler.cancelProject(pid);
    const cut = await settled(queued.id);
    expect(cut.failure!.kind).toBe("interrupted");
    worker.gate.resolve();
    expect((await settled(first.id)).failure!.kind).toBe("technical");
  });

  test("repair starts a Claude session with the error; nothing changed → the version renders again", async () => {
    worker.mode = "crash";
    const v = (await call<Version>("POST", "/render", {})).data;
    const failedAt = (await settled(v.id)).createdAt;
    await Bun.sleep(5); // the re-render gets a later createdAt
    const r = await call<{ ok: boolean }>("POST", `/versions/${v.id}/repair`);
    expect(r.status).toBe(200);
    expect(app.state().claude).toMatchObject({ running: true, repairing: v.id, task: `Réparer le rendu V${v.n}` });
    expect((await call("POST", `/versions/${v.id}/repair`)).status).toBe(409); // Claude is busy
    await until(() => existsSync(claudeArgs) && !app.claude.running, 10_000, "claude ends");
    const args = readFileSync(claudeArgs, "utf8");
    expect(args).toContain(`The render of version V${v.n} (${v.id}) failed`);
    expect(args).toContain("render worker exited (null)");
    expect(args).toContain("[remotion] segment (fake)");
    // The montage did not change: the same version is rendered again, then fails again here.
    await until(() => version(v.id).createdAt !== failedAt, 5000, "re-render");
    expect((await settled(v.id)).failure!.kind).toBe("technical");
    expect(app.state().claude.repairing).toBeUndefined();
    // A ready (or unknown) version cannot be repaired.
    expect((await call("POST", "/versions/v999/repair")).status).toBe(404);
  });
});
