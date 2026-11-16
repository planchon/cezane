import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { Anchor, CanvasDoc, type GenerateRequest, newId, type Op, type ProjectsEvent, type ServerEvent } from "@cezane/core";
import { CACHE_DIR, LIBRARY_DIR, listModels, REPO_DIR } from "@cezane/engine";
import type { CaptureRequest, Cezane } from "./app";
import type { Hub } from "./hub";
import { projectFiles } from "./library";
import { mcpHandler } from "./mcp";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

/** Serves a file with HTTP Range support (video seeking in the UI and in Remotion). */
function serveFile(path: string, req: Request): Response {
  if (!existsSync(path) || !statSync(path).isFile()) return new Response("not found", { status: 404 });
  const file = Bun.file(path);
  const size = file.size;
  const range = req.headers.get("range");
  const headers: Record<string, string> = { "Accept-Ranges": "bytes", "Content-Type": file.type, "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : size - Number(m[2]);
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      return new Response(file.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
    }
  }
  return new Response(file, { headers: { ...headers, "Content-Length": String(size) } });
}

/** Resolves `rel` inside `root`, refusing paths that escape it. */
function inside(root: string, rel: string): string | undefined {
  const r = resolve(root);
  const p = resolve(r, normalize(decodeURIComponent(rel)));
  return p === r || p.startsWith(r + sep) ? p : undefined;
}

const UI_DIR = join(REPO_DIR, "packages/app/dist");
const BRAND_DIR = join(REPO_DIR, "assets/brand");
const WORKFLOWS_DIR = join(LIBRARY_DIR, "workflows");

/** Server-sent events: `start` subscribes and returns the unsubscribe function. */
function sse(req: Request, start: (send: (data: unknown) => void) => () => void): Response {
  let unsub = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (e: unknown) => {
        try {
          ctrl.enqueue(`data: ${JSON.stringify(e)}\n\n`);
        } catch {
          unsub();
        }
      };
      const off = start(send);
      const ping = setInterval(() => {
        try {
          ctrl.enqueue(": ping\n\n");
        } catch {
          unsub();
        }
      }, 15_000);
      unsub = () => {
        off();
        clearInterval(ping);
      };
      req.signal.addEventListener("abort", () => unsub());
    },
    cancel: () => unsub(),
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

type ProjectRoute = [string, RegExp, (req: Request, m: RegExpExecArray, app: Cezane) => Promise<Response> | Response];
type GlobalRoute = [string, RegExp, (req: Request, m: RegExpExecArray) => Promise<Response> | Response];

/**
 * Routes of one project. Each is served as /api/p/:projectId/<route> and, for the default project
 * (the folder given to `cezane serve`), as the unscoped /api/<route> the app and the CLI use.
 */
const projectRoutes: ProjectRoute[] = [
    ["GET", /^\/api\/state$/, (_r, _m, app) => json(app.state())],
    ["GET", /^\/api\/events$/, (req, _m, app) => sse(req, (send) => (send({ type: "state", state: app.state() } satisfies ServerEvent), app.subscribe(send)))],
    ["GET", /^\/api\/claude\/log$/, (_r, _m, app) => json(app.claude.events)],
    // Reels (montages) of the project: list, create, select, rename.
    ["GET", /^\/api\/reels$/, (_r, _m, app) => json(app.reels())],
    [
      "POST",
      /^\/api\/reels$/,
      async (req, _m, app) => {
        const b = (await req.json().catch(() => ({}))) as { name?: string; select?: boolean };
        return json(app.createReel(b.name ?? "", b.select !== false));
      },
    ],
    ["POST", /^\/api\/reels\/([\w-]+)\/select$/, (_r, m, app) => (app.selectReel(m[1]!), json(app.state()))],
    [
      "PATCH",
      /^\/api\/reels\/([\w-]+)$/,
      async (req, m, app) => {
        const b = (await req.json().catch(() => ({}))) as { name?: string };
        return json(app.renameReel(m[1]!, b.name ?? ""));
      },
    ],
    [
      "POST",
      /^\/api\/claude\/send$/,
      async (req, _m, app) => {
        const b = (await req.json().catch(() => ({}))) as { commentIds?: string[] };
        app.sendToClaude(b.commentIds);
        return json({ ok: true });
      },
    ],
    [
      "POST",
      /^\/api\/claude\/ask$/,
      async (req, _m, app) => {
        const b = (await req.json()) as { text: string };
        if (!b.text?.trim()) return bad("text required");
        app.ask(b.text);
        return json({ ok: true });
      },
    ],
    ["POST", /^\/api\/claude\/stop$/, (_r, _m, app) => (app.claude.stop(), json({ ok: true }))],
    [
      "POST",
      /^\/api\/claude\/permission\/([\w-]+)$/,
      async (req, m, app) => {
        const b = (await req.json()) as { allow: boolean; message?: string };
        return app.answerPermission(m[1]!, b.allow, b.message) ? json({ ok: true }) : bad("unknown permission", 404);
      },
    ],
    [
      "POST",
      /^\/api\/comments$/,
      async (req, _m, app) => {
        const b = (await req.json()) as { anchor: unknown; text: string; snapshot?: string };
        const anchor = Anchor.parse(b.anchor);
        if (!b.text?.trim()) return bad("text required");
        return json(app.addComment(anchor, b.text.trim(), b.snapshot));
      },
    ],
    [
      "POST",
      /^\/api\/comments\/([\w-]+)\/reply$/,
      async (req, m, app) => {
        const c = app.comment(m[1]!);
        const b = (await req.json()) as { text: string };
        c.thread.push({ author: "user", text: b.text, at: new Date().toISOString() });
        if (c.status === "fixed" || c.status === "validated") c.status = "reopened";
        app.store.saveComments();
        app.changed();
        return json(c);
      },
    ],
    [
      "POST",
      /^\/api\/comments\/([\w-]+)\/status$/,
      async (req, m, app) => {
        const c = app.comment(m[1]!);
        const b = (await req.json()) as { status: "validated" | "reopened" | "draft" };
        if (!["validated", "reopened", "draft"].includes(b.status)) return bad("status must be validated, reopened or draft");
        c.status = b.status;
        app.store.saveComments();
        app.changed();
        return json(c);
      },
    ],
    [
      "DELETE",
      /^\/api\/comments\/([\w-]+)$/,
      (_r, m, app) => {
        app.store.comments = app.store.comments.filter((c) => c.id !== m[1]);
        app.store.saveComments();
        app.changed();
        return json({ ok: true });
      },
    ],
    [
      "POST",
      /^\/api\/render$/,
      async (req, _m, app) => {
        const b = (await req.json().catch(() => ({}))) as { summary?: string };
        return json(app.renderVersion("user", b.summary ?? "Rendu manuel"));
      },
    ],
    ["GET", /^\/api\/versions\/(v\d+)\/montage$/, (_r, m, app) => json(app.store.versionMontage(m[1]!) ?? null)],
    ["POST", /^\/api\/versions\/(v\d+)\/restore$/, (_r, m, app) => (app.store.restoreVersion(m[1]!) ? (app.changed(), json({ ok: true })) : bad("unknown version", 404))],
    [
      "POST",
      /^\/api\/edit$/,
      async (req, _m, app) => {
        const b = (await req.json()) as { ops: Op[]; reason?: string; author?: "user" | "claude" };
        const r = app.store.edit(b.ops, b.author ?? "user", b.reason);
        app.changed();
        return json(r);
      },
    ],
    ["POST", /^\/api\/undo$/, (_r, _m, app) => (app.store.undo() ? (app.changed(), json({ ok: true })) : bad("nothing to undo"))],
    [
      "POST",
      /^\/api\/import$/,
      async (req, _m, app) => {
        const b = (await req.json()) as { paths: string[]; capture?: "web" | "ios"; target?: string };
        const provenance = b.capture ? { type: "capture" as const, source: b.capture, target: b.target ?? b.capture } : undefined;
        return json(await app.importFiles(b.paths, provenance));
      },
    ],
    [
      "POST",
      /^\/api\/upload$/,
      async (req, _m, app) => {
        // Written straight into Rushes/ under their own names, then imported where they are.
        const form = await req.formData();
        return json(await app.importUploads(form.getAll("file").filter((f): f is File => typeof f !== "string")));
      },
    ],
    ["GET", /^\/api\/transcript\/([\w-]+)$/, (_r, m, app) => json(app.store.transcript(m[1]!) ?? null)],
    ["GET", /^\/api\/waveform\/([\w-]+)$/, (_r, m, app) => json(app.store.waveform(m[1]!) ?? null)],
    [
      "GET",
      /^\/api\/graphics$/,
      async () => {
        const { graphicInfos } = (await import("@cezane/remotion/src/catalog.ts")) as { graphicInfos: () => unknown[] };
        return json(graphicInfos());
      },
    ],
    ["GET", /^\/api\/canvases$/, (_r, _m, app) => json(app.store.project.canvases)],
    [
      "POST",
      /^\/api\/canvases$/,
      async (req, _m, app) => {
        const b = (await req.json().catch(() => ({}))) as { name?: string };
        const doc = CanvasDoc.parse({ id: newId("cv"), name: b.name ?? "Canvas", updatedAt: new Date().toISOString() });
        app.store.saveCanvas(doc);
        app.changed();
        return json(doc);
      },
    ],
    ["GET", /^\/api\/canvas\/([\w-]+)$/, (_r, m, app) => json(app.store.canvas(m[1]!) ?? null)],
    [
      "PUT",
      /^\/api\/canvas\/([\w-]+)$/,
      async (req, m, app) => {
        const doc = app.store.canvas(m[1]!);
        if (!doc) return bad("unknown canvas", 404);
        const b = (await req.json()) as { snapshot: { document?: { store?: Record<string, unknown> } } };
        // Pending shapes the UI has materialized are now part of the snapshot.
        const saved = b.snapshot?.document?.store ?? {};
        app.store.saveCanvas({ ...doc, snapshot: b.snapshot, pending: doc.pending.filter((r) => !(String(r.id) in saved)) });
        return json({ ok: true });
      },
    ],
    ["GET", /^\/api\/models$/, async () => json(await listModels())],
    [
      "POST",
      /^\/api\/generate$/,
      async (req, _m, app) => {
        const b = (await req.json()) as GenerateRequest;
        const done = app.generate(b);
        // Return the job as soon as it is queued; the UI follows it in state.jobs.
        const job = await Promise.race([done.then((j) => j), new Promise((r) => setTimeout(() => r(app.jobs.list.at(-1)), 150))]);
        done.catch(() => undefined);
        return json(job);
      },
    ],
    [
      "GET",
      /^\/api\/workflows$/,
      () => {
        mkdirSync(WORKFLOWS_DIR, { recursive: true });
        return json(readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), "utf8"))));
      },
    ],
    [
      "POST",
      /^\/api\/workflows$/,
      async (req) => {
        // Stored as sent by the UI (shapes, bindings, assets, root ids, tldraw schema).
        const b = (await req.json()) as Record<string, unknown> & { name: string };
        mkdirSync(WORKFLOWS_DIR, { recursive: true });
        const wf = { ...b, id: newId("wf"), createdAt: new Date().toISOString() };
        writeFileSync(join(WORKFLOWS_DIR, `${wf.id}.json`), JSON.stringify(wf, null, 2));
        return json(wf);
      },
    ],
  ["GET", /^\/api\/files$/, (_r, _m, app) => json(projectFiles(app))],
  [
    "POST",
    /^\/api\/reveal$/,
    async (req, _m, app) => {
      const b = (await req.json().catch(() => ({}))) as { path?: string; assetId?: string; versionId?: string };
      return json({ ok: true, path: app.reveal(b) });
    },
  ],
  [
    "POST",
    /^\/api\/capture$/,
    async (req, _m, app) => {
      const b = (await req.json()) as CaptureRequest;
      if (b.target !== "web" && b.target !== "ios") return bad("target must be web or ios");
      const done = app.capture(b);
      done.catch(() => undefined);
      // The job is queued at once (behind any other capture); the UI follows it in state.jobs.
      const job = await Promise.race([done, new Promise((r) => setTimeout(() => r(app.jobs.list.filter((j) => j.kind === "capture").at(-1)), 150))]);
      return json(job);
    },
  ],
  ["POST", /^\/api\/versions\/(v\d+)\/export$/, (_r, m, app) => json(app.exportVersion(m[1]!))],
  ["POST", /^\/api\/mcp$/, (req, _m, app) => mcpHandler(app)(req)],
  ["GET", /^\/api\/mcp$/, (req, _m, app) => mcpHandler(app)(req)],
  ["DELETE", /^\/api\/mcp$/, (req, _m, app) => mcpHandler(app)(req)],
];

export function startHttp(hub: Hub, port: number) {
  /** Routes about all projects (home tab) and the global scheduler. */
  const globalRoutes: GlobalRoute[] = [
    ["GET", /^\/api\/projects$/, () => json(hub.summaries())],
    ["GET", /^\/api\/projects\/events$/, (req) => sse(req, (send) => (send({ type: "projects", projects: hub.summaries() } satisfies ProjectsEvent), hub.subscribeProjects(send)))],
    [
      "POST",
      /^\/api\/projects$/,
      async (req) => {
        const b = (await req.json().catch(() => ({}))) as { name?: string };
        return json(hub.create(b.name ?? ""));
      },
    ],
    [
      "POST",
      /^\/api\/projects\/open$/,
      async (req) => {
        const b = (await req.json().catch(() => ({}))) as { path?: string; init?: boolean };
        return json(hub.open(b.path ?? "", b.init));
      },
    ],
    ["GET", /^\/api\/projects\/([\w.-]+)$/, (_r, m) => json(hub.summary(m[1]!))],
    ["DELETE", /^\/api\/projects\/([\w.-]+)$/, (_r, m) => (hub.forget(m[1]!), json({ ok: true }))],
    ["GET", /^\/api\/jobs$/, () => json(hub.scheduler.state())],
  ];

  const dispatch = async (req: Request, path: string, app: () => Cezane): Promise<Response | undefined> => {
    for (const [method, re, handler] of projectRoutes) {
      const m = re.exec(path);
      if (m && req.method === method) return await handler(req, m, app());
    }
    return undefined;
  };

  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      try {
        // /api/p/:projectId/<route>: the same routes, for any project.
        const scoped = /^\/api\/p\/([\w.-]+)(\/.*)?$/.exec(path);
        if (scoped) return (await dispatch(req, `/api${scoped[2] ?? ""}`, () => hub.get(scoped[1]!))) ?? bad("not found", 404);
        if (path === "/mcp") return await mcpHandler(hub.default())(req);
        for (const [method, re, handler] of globalRoutes) {
          const m = re.exec(path);
          if (m && req.method === method) return await handler(req, m);
        }
        // Unscoped routes: the default project.
        if (path.startsWith("/api/")) return (await dispatch(req, path, () => hub.default())) ?? bad("not found", 404);
        const files = /^\/files\/p\/([\w.-]+)\/(.*)$/.exec(path);
        if (files) {
          const p = inside(hub.get(files[1]!).store.dir, files[2]!);
          return p ? serveFile(p, req) : bad("forbidden", 403);
        }
        if (path.startsWith("/files/project/")) {
          const p = inside(hub.default().store.dir, path.slice("/files/project/".length));
          return p ? serveFile(p, req) : bad("forbidden", 403);
        }
        if (path.startsWith("/files/cache/")) {
          const p = inside(CACHE_DIR, path.slice("/files/cache/".length));
          return p ? serveFile(p, req) : bad("forbidden", 403);
        }
        if (path.startsWith("/brand/")) {
          const p = inside(BRAND_DIR, path.slice("/brand/".length));
          return p ? serveFile(p, req) : bad("forbidden", 403);
        }
        // The UI (single page app).
        const p = inside(UI_DIR, path === "/" ? "index.html" : path.slice(1));
        if (p && existsSync(p) && statSync(p).isFile()) return serveFile(p, req);
        const index = join(UI_DIR, "index.html");
        return existsSync(index) ? serveFile(index, req) : new Response("UI not built: run `bun run build:ui`", { status: 404 });
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (!status || status >= 500) console.error(e);
        return bad(e instanceof Error ? e.message : String(e), status ?? 500);
      }
    },
  });
}
