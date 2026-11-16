import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Comment, ProjectSummary, ReelSummary, ServerState, Version } from "@cezane/core";
import { tempDir } from "../test/helpers";
import { Cezane } from "./app";
import { startHttp } from "./http";
import { Hub } from "./hub";
import { ProjectStore } from "./store";

const t = tempDir("cezane-reels-");
const port = 49_000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let hub: Hub;
let server: ReturnType<typeof startHttp>;

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: (await r.json()) as T };
}
const get = <T>(path: string) => call<T>("GET", path).then((r) => r.data);
const title = (text: string) => ({ op: "add_clip", track: "t_gfx", clip: { type: "graphic", component: "Title", start: 0, duration: 30, props: { text } } });
const titles = (s: ServerState) => s.montage.tracks.find((x) => x.id === "t_gfx")!.clips.map((c) => (c.type === "graphic" ? c.props.text : ""));

async function mcp(path: string, name: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return ((await r.json()) as { result: { content: { text: string }[] } }).result.content[0]!.text;
}

beforeAll(() => {
  Cezane.revealCommand = ["true"];
  hub = new Hub({ port, home: join(t.dir, "Cezane"), demos: false, watch: false });
  hub.setDefault(join(t.dir, "Défaut"), { name: "Projet par défaut" });
  server = startHttp(hub, port);
});
afterAll(async () => {
  server.stop(true);
  await hub.stop();
  t.cleanup();
});

describe("reels", () => {
  let p: ProjectSummary;
  let first: string;
  let second: ReelSummary;

  test("an existing project has one reel, selected, with its history where it always was", async () => {
    p = (await call<ProjectSummary>("POST", "/api/projects", { name: "Dax" })).data;
    const s = await get<ServerState>(`/api/p/${p.id}/state`);
    first = s.montage.id;
    expect(s.reels).toHaveLength(1);
    expect(s.reels![0]).toMatchObject({ id: first, active: true, status: "draft", comments: { open: 0, toReview: 0 } });
    const r = await call<{ revision: number }>("POST", `/api/p/${p.id}/edit`, { ops: [title("A1")] });
    expect(r.data.revision).toBe(1);
    expect(existsSync(join(p.path, ".cezane/history/1.json"))).toBe(true);
    expect(await get<ReelSummary[]>(`/api/p/${p.id}/reels`)).toHaveLength(1);
  });

  test("create a reel: empty, same format, selected; edits and undo stay on it", async () => {
    await call("POST", `/api/p/${p.id}/edit`, { ops: [{ op: "set_settings", set: { fps: 25 } }] });
    const r = await call<ReelSummary>("POST", `/api/p/${p.id}/reels`, { name: "Onboarding" });
    expect(r.status).toBe(200);
    second = r.data;
    expect(second).toMatchObject({ name: "Onboarding", active: true, status: "draft", versions: 0 });
    expect((await call("POST", `/api/p/${p.id}/reels`, { name: "  " })).status).toBe(400);

    let s = await get<ServerState>(`/api/p/${p.id}/state`);
    expect(s.montage.id).toBe(second.id);
    expect(s.montage.name).toBe("Onboarding");
    expect(s.montage.settings.fps).toBe(25); // the selected reel's format
    expect(s.revision).toBe(0);
    expect(titles(s)).toEqual([]);
    expect(s.project.montages.map((m) => m.name)).toEqual(["Montage", "Onboarding"]);
    expect(s.reels!.map((x) => [x.name, x.active])).toEqual([["Montage", false], ["Onboarding", true]]);

    expect((await call<{ revision: number }>("POST", `/api/p/${p.id}/edit`, { ops: [title("B1")] })).data.revision).toBe(1);
    expect((await call<{ revision: number }>("POST", `/api/p/${p.id}/edit`, { ops: [title("B2")] })).data.revision).toBe(2);
    expect(existsSync(join(p.path, `.cezane/history/${second.id}/2.json`))).toBe(true);
    expect((await call("POST", `/api/p/${p.id}/undo`)).status).toBe(200);
    s = await get<ServerState>(`/api/p/${p.id}/state`);
    expect(s.revision).toBe(3);
    expect(titles(s)).toEqual(["B1"]);

    // The first reel did not move.
    const store = hub.get(p.id).store;
    expect(store.reel(first).revision).toBe(2);
    expect(store.reel(first).montage.tracks.find((x) => x.id === "t_gfx")!.clips).toHaveLength(1);
  });

  test("select a reel: state, revision and the unscoped default follow; it survives a restart", async () => {
    const s = (await call<ServerState>("POST", `/api/p/${p.id}/reels/${first}/select`)).data;
    expect(s.montage.id).toBe(first);
    expect(s.revision).toBe(2);
    expect(titles(s)).toEqual(["A1"]);
    expect((await call("POST", `/api/p/${p.id}/reels/m_absent/select`)).status).toBe(404);
    await call("POST", `/api/p/${p.id}/reels/${second.id}/select`);
    expect(JSON.parse(readFileSync(join(p.path, ".cezane/active-reel.json"), "utf8")).id).toBe(second.id);
    const reloaded = new ProjectStore(p.path).load();
    expect(reloaded.activeId).toBe(second.id);
    expect(reloaded.revision).toBe(3);
    expect(reloaded.reel(first).revision).toBe(2);
    // The home tab sees the selected reel, loaded or not.
    const sum = (await get<ProjectSummary[]>("/api/projects")).find((x) => x.id === p.id)!;
    expect(sum.reels.find((x) => x.active)!.id).toBe(second.id);
  });

  test("rename a reel: project list and montage, kept through undo", async () => {
    const r = await call<ReelSummary>("PATCH", `/api/p/${p.id}/reels/${second.id}`, { name: "Onboarding refait" });
    expect(r.data.name).toBe("Onboarding refait");
    expect((await call("PATCH", `/api/p/${p.id}/reels/${second.id}`, { name: "" })).status).toBe(400);
    await call("POST", `/api/p/${p.id}/edit`, { ops: [title("B3")] });
    await call("POST", `/api/p/${p.id}/undo`);
    const s = await get<ServerState>(`/api/p/${p.id}/state`);
    expect(s.montage.name).toBe("Onboarding refait");
    expect(s.project.montages.find((m) => m.id === second.id)!.name).toBe("Onboarding refait");
    const disk = JSON.parse(readFileSync(join(p.path, "cezane.json"), "utf8")) as { montages: { name: string }[] };
    expect(disk.montages[1]!.name).toBe("Onboarding refait");
  });

  test("comments and versions belong to their reel; numbers count per reel", async () => {
    const anchor = (montageId: string) => ({ kind: "montage", montageId, versionId: "v0", frame: 0 });
    await call("POST", `/api/p/${p.id}/reels/${first}/select`);
    await call<Comment>("POST", `/api/p/${p.id}/comments`, { anchor: anchor(first), text: "A · un" });
    await call<Comment>("POST", `/api/p/${p.id}/comments`, { anchor: anchor(first), text: "A · deux" });
    await call("POST", `/api/p/${p.id}/reels/${second.id}/select`);
    const c = (await call<Comment>("POST", `/api/p/${p.id}/comments`, { anchor: anchor(second.id), text: "B · un" })).data;
    expect(c.n).toBe(1);
    let s = await get<ServerState>(`/api/p/${p.id}/state`);
    expect(s.comments.map((x) => x.thread[0]!.text)).toEqual(["B · un"]);
    expect(s.reels!.find((x) => x.id === first)!.comments).toEqual({ open: 2, toReview: 0 });

    // Versions: ids unique in the project, numbers per reel (two versions of the first reel exist).
    const store = hub.get(p.id).store;
    const v = (id: string, n: number, montageId: string): Version =>
      ({ id, n, montageId, revision: 1, author: "claude", summary: "", status: "ready", progress: 1, montageFile: "x", durationFrames: 30, fps: 30, changed: [], comments: [], segmentKeys: [], createdAt: new Date().toISOString() }) as Version;
    store.versions.push(v("v1", 1, first), v("v2", 2, first));
    expect(store.nextVersion(second.id)).toEqual({ id: "v3", n: 1 });
    expect(store.nextVersion(first)).toEqual({ id: "v3", n: 3 });
    store.versions.push(v("v3", 1, second.id));
    expect(store.nextVersion(first)).toEqual({ id: "v4", n: 3 });
    s = await get<ServerState>(`/api/p/${p.id}/state`);
    expect(s.versions.map((x) => x.id)).toEqual(["v3"]);
    expect(s.reels!.find((x) => x.id === first)!.versions).toBe(2);
    store.versions.splice(0);
  });

  test("MCP acts on the selected reel, or on the reel given in ?reel= (Claude sessions)", async () => {
    // second is selected
    expect(await mcp(`/api/p/${p.id}/mcp`, "overview")).toContain(`montage ${second.id}`);
    expect(await mcp(`/api/p/${p.id}/mcp?reel=${first}`, "overview")).toContain(`montage ${first}`);
    await mcp(`/api/p/${p.id}/mcp?reel=${first}`, "edit", { ops: [title("A2")], reason: "pinned" });
    const store = hub.get(p.id).store;
    expect(store.activeId).toBe(second.id);
    expect(store.reel(first).montage.tracks.find((x) => x.id === "t_gfx")!.clips).toHaveLength(2);
    expect(titles(await get<ServerState>(`/api/p/${p.id}/state`))).toEqual(["B1"]);
    const app = hub.get(p.id);
    expect(app.mcpUrl(first)).toBe(`${base}/api/p/${p.id}/mcp?reel=${first}`);
  });

  test("legacy: unscoped routes act on the default project's selected reel; old projects load unchanged", async () => {
    const created = (await call<ReelSummary>("POST", "/api/reels", { name: "Teaser", select: false })).data;
    expect(created.active).toBe(false);
    const s = await get<ServerState>("/api/state");
    expect(s.montage.name).toBe("Montage");
    expect(s.reels!.map((x) => x.name)).toEqual(["Montage", "Teaser"]);
    await call("POST", `/api/reels/${created.id}/select`);
    expect((await call<{ revision: number }>("POST", "/api/edit", { ops: [title("T")] })).data.revision).toBe(1);
    expect((await get<ServerState>("/api/state")).montage.id).toBe(created.id);

    // A project written before reels (no active-reel.json, history in .cezane/history) loads its first montage.
    const dir = join(t.dir, "Ancien");
    const old = ProjectStore.init(dir, "Ancien");
    old.edit([title("vieux")] as never, "user");
    writeFileSync(join(dir, "versions.json"), JSON.stringify([]));
    const again = new ProjectStore(dir).load();
    expect(again.activeId).toBe(old.project.montages[0]!.id);
    expect(again.revision).toBe(1);
    expect(again.reel().historyDir).toBe(".cezane/history");
    expect(again.undo()).toBe(true);
    expect(again.revision).toBe(2);
  });
});
