import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { Anchor, CanvasDoc, type GenerateRequest, type Op, type ServerEvent, newId } from "@cezane/core";
import { CACHE_DIR, LIBRARY_DIR, listModels, REPO_DIR } from "@cezane/engine";
import type { Cezane } from "./app";
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
  const p = resolve(root, normalize(decodeURIComponent(rel)));
  return p.startsWith(resolve(root)) ? p : undefined;
}

const UI_DIR = join(REPO_DIR, "packages/app/dist");
const BRAND_DIR = join(REPO_DIR, "assets/brand");
const WORKFLOWS_DIR = join(LIBRARY_DIR, "workflows");

export function startHttp(app: Cezane, port: number) {
  const mcp = mcpHandler(app);
  const s = app.store;

  const routes: [string, RegExp, (req: Request, m: RegExpExecArray) => Promise<Response> | Response][] = [
    ["GET", /^\/api\/state$/, () => json(app.state())],
    [
      "GET",
      /^\/api\/events$/,
      (req) => {
        let unsub = () => {};
        let ping: ReturnType<typeof setInterval>;
        const stream = new ReadableStream({
          start(ctrl) {
            const send = (e: ServerEvent) => ctrl.enqueue(`data: ${JSON.stringify(e)}\n\n`);
            send({ type: "state", state: app.state() });
            const off = app.subscribe(send);
            ping = setInterval(() => ctrl.enqueue(": ping\n\n"), 15_000);
            unsub = () => {
              off();
              clearInterval(ping);
            };
            req.signal.addEventListener("abort", () => unsub());
          },
          cancel: () => unsub(),
        });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
      },
    ],
    ["GET", /^\/api\/claude\/log$/, () => json(app.claude.events)],
    [
      "POST",
      /^\/api\/claude\/send$/,
      async (req) => {
        const b = (await req.json().catch(() => ({}))) as { commentIds?: string[] };
        app.sendToClaude(b.commentIds);
        return json({ ok: true });
      },
    ],
    [
      "POST",
      /^\/api\/claude\/ask$/,
      async (req) => {
        const b = (await req.json()) as { text: string };
        if (!b.text?.trim()) return bad("text required");
        app.ask(b.text);
        return json({ ok: true });
      },
    ],
    ["POST", /^\/api\/claude\/stop$/, () => (app.claude.stop(), json({ ok: true }))],
    [
      "POST",
      /^\/api\/claude\/permission\/([\w-]+)$/,
      async (req, m) => {
        const b = (await req.json()) as { allow: boolean; message?: string };
        return app.answerPermission(m[1]!, b.allow, b.message) ? json({ ok: true }) : bad("unknown permission", 404);
      },
    ],
    [
      "POST",
      /^\/api\/comments$/,
      async (req) => {
        const b = (await req.json()) as { anchor: unknown; text: string; snapshot?: string };
        const anchor = Anchor.parse(b.anchor);
        if (!b.text?.trim()) return bad("text required");
        return json(app.addComment(anchor, b.text.trim(), b.snapshot));
      },
    ],
    [
      "POST",
      /^\/api\/comments\/([\w-]+)\/reply$/,
      async (req, m) => {
        const c = app.comment(m[1]!);
        const b = (await req.json()) as { text: string };
        c.thread.push({ author: "user", text: b.text, at: new Date().toISOString() });
        if (c.status === "fixed" || c.status === "validated") c.status = "reopened";
        s.saveComments();
        app.changed();
        return json(c);
      },
    ],
    [
      "POST",
      /^\/api\/comments\/([\w-]+)\/status$/,
      async (req, m) => {
        const c = app.comment(m[1]!);
        const b = (await req.json()) as { status: "validated" | "reopened" | "draft" };
        if (!["validated", "reopened", "draft"].includes(b.status)) return bad("status must be validated, reopened or draft");
        c.status = b.status;
        s.saveComments();
        app.changed();
        return json(c);
      },
    ],
    [
      "DELETE",
      /^\/api\/comments\/([\w-]+)$/,
      (_r, m) => {
        s.comments = s.comments.filter((c) => c.id !== m[1]);
        s.saveComments();
        app.changed();
        return json({ ok: true });
      },
    ],
    [
      "POST",
      /^\/api\/render$/,
      async (req) => {
        const b = (await req.json().catch(() => ({}))) as { summary?: string };
        return json(app.renderVersion("user", b.summary ?? "Rendu manuel"));
      },
    ],
    ["GET", /^\/api\/versions\/(v\d+)\/montage$/, (_r, m) => json(s.versionMontage(m[1]!) ?? null)],
    ["POST", /^\/api\/versions\/(v\d+)\/restore$/, (_r, m) => (s.restoreVersion(m[1]!) ? (app.changed(), json({ ok: true })) : bad("unknown version", 404))],
    [
      "POST",
      /^\/api\/edit$/,
      async (req) => {
        const b = (await req.json()) as { ops: Op[]; reason?: string; author?: "user" | "claude" };
        const r = s.edit(b.ops, b.author ?? "user", b.reason);
        app.changed();
        return json(r);
      },
    ],
    ["POST", /^\/api\/undo$/, () => (s.undo() ? (app.changed(), json({ ok: true })) : bad("nothing to undo"))],
    [
      "POST",
      /^\/api\/import$/,
      async (req) => {
        const b = (await req.json()) as { paths: string[] };
        return json(await app.importFiles(b.paths));
      },
    ],
    [
      "POST",
      /^\/api\/upload$/,
      async (req) => {
        const form = await req.formData();
        const dir = s.path(".cezane/uploads");
        mkdirSync(dir, { recursive: true });
        const paths: string[] = [];
        for (const f of form.getAll("file")) {
          if (typeof f === "string") continue;
          const p = join(dir, `${newId("u")}-${f.name.replace(/[^\w.-]/g, "_")}`);
          await Bun.write(p, f);
          paths.push(p);
        }
        return json(await app.importFiles(paths));
      },
    ],
    ["GET", /^\/api\/transcript\/([\w-]+)$/, (_r, m) => json(s.transcript(m[1]!) ?? null)],
    ["GET", /^\/api\/waveform\/([\w-]+)$/, (_r, m) => json(s.waveform(m[1]!) ?? null)],
    [
      "GET",
      /^\/api\/graphics$/,
      async () => {
        const { graphicInfos } = (await import("@cezane/remotion/src/catalog.ts")) as { graphicInfos: () => unknown[] };
        return json(graphicInfos());
      },
    ],
    ["GET", /^\/api\/canvases$/, () => json(s.project.canvases)],
    [
      "POST",
      /^\/api\/canvases$/,
      async (req) => {
        const b = (await req.json().catch(() => ({}))) as { name?: string };
        const doc = CanvasDoc.parse({ id: newId("cv"), name: b.name ?? "Canvas", updatedAt: new Date().toISOString() });
        s.saveCanvas(doc);
        app.changed();
        return json(doc);
      },
    ],
    ["GET", /^\/api\/canvas\/([\w-]+)$/, (_r, m) => json(s.canvas(m[1]!) ?? null)],
    [
      "PUT",
      /^\/api\/canvas\/([\w-]+)$/,
      async (req, m) => {
        const doc = s.canvas(m[1]!);
        if (!doc) return bad("unknown canvas", 404);
        const b = (await req.json()) as { snapshot: unknown };
        s.saveCanvas({ ...doc, snapshot: b.snapshot });
        return json({ ok: true });
      },
    ],
    ["GET", /^\/api\/models$/, async () => json(await listModels())],
    [
      "POST",
      /^\/api\/generate$/,
      async (req) => {
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
        const b = (await req.json()) as { name: string; shapes: unknown[]; bindings: unknown[] };
        mkdirSync(WORKFLOWS_DIR, { recursive: true });
        const wf = { id: newId("wf"), name: b.name, createdAt: new Date().toISOString(), shapes: b.shapes, bindings: b.bindings ?? [] };
        writeFileSync(join(WORKFLOWS_DIR, `${wf.id}.json`), JSON.stringify(wf, null, 2));
        return json(wf);
      },
    ],
  ];

  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      try {
        if (path === "/mcp") return await mcp(req);
        for (const [method, re, handler] of routes) {
          const m = re.exec(path);
          if (m && req.method === method) return await handler(req, m);
        }
        if (path.startsWith("/files/project/")) {
          const p = inside(s.dir, path.slice("/files/project/".length));
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
        if (path.startsWith("/api/")) return bad("not found", 404);
        // The UI (single page app).
        const p = inside(UI_DIR, path === "/" ? "index.html" : path.slice(1));
        if (p && existsSync(p) && statSync(p).isFile()) return serveFile(p, req);
        const index = join(UI_DIR, "index.html");
        return existsSync(index) ? serveFile(index, req) : new Response("UI not built: run `bun run build:ui`", { status: 404 });
      } catch (e) {
        console.error(e);
        return bad(e instanceof Error ? e.message : String(e), 500);
      }
    },
  });
}
