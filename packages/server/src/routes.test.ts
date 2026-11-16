import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FilesListing, ProjectSummary, SchedulerState, ServerState } from "@cezane/core";
import { tempDir } from "../test/helpers";
import { Cezane } from "./app";
import { startHttp } from "./http";
import { Hub } from "./hub";

const t = tempDir("cezane-routes-");
const port = 47_000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let hub: Hub;
let server: ReturnType<typeof startHttp>;

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: (await r.json()) as T };
}
const get = <T>(path: string) => call<T>("GET", path).then((r) => r.data);
const graphic = { op: "add_clip", track: "t_gfx", clip: { type: "graphic", component: "Title", start: 0, duration: 30, props: { text: "Bonjour" } } };

beforeAll(() => {
  Cezane.revealCommand = ["true"]; // never open the Finder from a test
  hub = new Hub({ port, home: join(t.dir, "Cezane"), demos: false, watch: false });
  hub.setDefault(join(t.dir, "Défaut"), { name: "Projet par défaut" });
  server = startHttp(hub, port);
});
afterAll(async () => {
  server.stop(true);
  await hub.stop();
  t.cleanup();
});

describe("routes", () => {
  let a: ProjectSummary;
  let b: ProjectSummary;

  test("projects: create, list, summary", async () => {
    a = (await call<ProjectSummary>("POST", "/api/projects", { name: "Reel A" })).data;
    b = (await call<ProjectSummary>("POST", "/api/projects", { name: "Reel B" })).data;
    expect(a.path).toBe(join(t.dir, "Cezane/Projets/Reel A"));
    expect(a.reels).toHaveLength(1);
    expect(a.reels[0]!.status).toBe("draft");
    const list = await get<ProjectSummary[]>("/api/projects");
    expect(list.map((p) => p.name).sort()).toEqual(["Projet par défaut", "Reel A", "Reel B"]);
    expect(list.find((p) => p.isDefault)!.name).toBe("Projet par défaut");
    expect((await get<ProjectSummary>(`/api/projects/${b.id}`)).name).toBe("Reel B");
    expect((await call("POST", "/api/projects", {})).status).toBe(400);
  });

  test("project-scoped routes act on their project only", async () => {
    const ra = await call<{ revision: number }>("POST", `/api/p/${a.id}/edit`, { ops: [graphic], reason: "titre" });
    expect(ra.data.revision).toBe(1);
    const sa = await get<ServerState>(`/api/p/${a.id}/state`);
    const sb = await get<ServerState>(`/api/p/${b.id}/state`);
    expect(sa.projectId).toBe(a.id);
    expect(sa.project.name).toBe("Reel A");
    expect(sa.montage.tracks.find((x) => x.id === "t_gfx")!.clips).toHaveLength(1);
    expect(sb.revision).toBe(0);
    const c = await call<{ id: string }>("POST", `/api/p/${b.id}/comments`, { anchor: { kind: "montage", montageId: sb.montage.id, versionId: "v0", frame: 0 }, text: "plus court" });
    expect(c.status).toBe(200);
    expect((await get<ServerState>(`/api/p/${b.id}/state`)).comments).toHaveLength(1);
    expect((await get<ServerState>(`/api/p/${a.id}/state`)).comments).toHaveLength(0);
    expect((await call("GET", "/api/p/inconnu/state")).status).toBe(404);
    expect((await call("GET", `/api/p/${a.id}/nope`)).status).toBe(404);
  });

  test("legacy unscoped routes still work, on the default project", async () => {
    const s = await get<ServerState>("/api/state");
    expect(s.project.name).toBe("Projet par défaut");
    expect(s.projectId).toBe(hub.defaultId!);
    const r = await call<{ revision: number }>("POST", "/api/edit", { ops: [graphic] });
    expect(r.data.revision).toBe(1);
    expect((await call("POST", "/api/undo")).status).toBe(200);
    expect((await get<ServerState>("/api/state")).revision).toBe(2);
    expect((await get<ServerState>(`/api/p/${a.id}/state`)).revision).toBe(1); // untouched
    expect(await get<unknown[]>("/api/canvases")).toHaveLength(1);
    expect(Array.isArray(await get<unknown[]>(`/api/p/${a.id}/canvases`))).toBe(true);
    expect((await fetch(`${base}/files/project/cezane.json`).then((x) => x.json())).name).toBe("Projet par défaut");
    expect((await fetch(`${base}/files/p/${b.id}/cezane.json`).then((x) => x.json())).name).toBe("Reel B");
    expect((await fetch(`${base}/files/p/${b.id}/..%2F..%2Fsecret`)).status).toBe(403);
  });

  test("SSE streams per project", async () => {
    const ctrl = new AbortController();
    const r = await fetch(`${base}/api/p/${b.id}/events`, { signal: ctrl.signal });
    const reader = r.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toStartWith("data: ");
    expect(JSON.parse(first.slice(6)).state.projectId).toBe(b.id);
    ctrl.abort();
  });

  test("MCP per project", async () => {
    const rpc = async (path: string, name: string) => {
      const r = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
      });
      return ((await r.json()) as { result: { content: { text: string }[] } }).result.content[0]!.text;
    };
    expect(await rpc(`/api/p/${a.id}/mcp`, "overview")).toContain('Project "Reel A"');
    expect(await rpc("/mcp", "overview")).toContain('Project "Projet par défaut"');
  });

  test("files listing and reveal", async () => {
    const dir = hub.get(a.id).store.dir;
    mkdirSync(join(dir, "Rushes/Jour 1"), { recursive: true });
    writeFileSync(join(dir, "Rushes/Jour 1/notes.txt"), "x");
    const f = await get<FilesListing>(`/api/p/${a.id}/files`);
    expect(f.folders.map((x) => x.name)).toEqual(["Rushes", "Générés", "Captures", "Exports"]);
    const day = f.folders[0]!.folders[0]!;
    expect(day.path).toBe("Rushes/Jour 1");
    expect(day.files[0]).toMatchObject({ name: "notes.txt", kind: "other", size: 1, folder: "Rushes", url: `/files/p/${a.id}/Rushes/Jour%201/notes.txt` });
    const ok = await call<{ path: string }>("POST", `/api/p/${a.id}/reveal`, { path: "Rushes/Jour 1/notes.txt" });
    expect(ok.data.path).toBe(join(dir, "Rushes/Jour 1/notes.txt"));
    expect((await call("POST", `/api/p/${a.id}/reveal`, {})).data).toMatchObject({ path: dir });
    expect((await call("POST", `/api/p/${a.id}/reveal`, { path: "../../etc" })).status).toBe(403);
    expect((await call("POST", `/api/p/${a.id}/reveal`, { path: "Rushes/absent.mov" })).status).toBe(404);
    expect((await call("POST", `/api/p/${a.id}/reveal`, { assetId: "a_none" })).status).toBe(404);
  });

  test("open an existing folder, forget a project, global jobs", async () => {
    const ext = join(t.dir, "Ailleurs");
    mkdirSync(ext, { recursive: true });
    expect((await call("POST", "/api/projects/open", { path: ext })).status).toBe(400);
    const opened = (await call<ProjectSummary>("POST", "/api/projects/open", { path: ext, init: true })).data;
    expect(opened.location).toBe("external");
    expect(opened.loaded).toBe(true);
    expect((await call("DELETE", `/api/projects/${opened.id}`)).status).toBe(200);
    expect((await get<ProjectSummary[]>("/api/projects")).some((p) => p.id === opened.id)).toBe(false);
    expect(existsSync(join(ext, "cezane.json"))).toBe(true); // forgetting never deletes
    expect((await call("GET", `/api/p/${opened.id}/state`)).status).toBe(404);
    const jobs = await get<SchedulerState>("/api/jobs");
    expect(jobs.limits.capture).toBe(1);
    expect(jobs.perProject.render).toBe(1);
  });
});
