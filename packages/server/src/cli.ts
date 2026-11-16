#!/usr/bin/env bun
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClaudeEvent, ProjectSummary, ServerEvent, ServerState } from "@cezane/core";
import { startHttp } from "./http";
import { Hub } from "./hub";
import { ProjectRegistry } from "./registry";
import { ProjectStore } from "./store";

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const port = Number(flag("port", process.env.CEZANE_PORT ?? "4317"));
const outFlag = flag("out");
const reasonFlag = flag("reason");
const nameFlag = flag("name");
const captureFlag = flag("capture");
const targetFlag = flag("target");
const projectFlag = flag("project");
const parallelFlag = flag("parallel");
const base = `http://127.0.0.1:${port}`;
/** Project routes: the default project, or /api/p/<id>/… with --project <id>. */
const p = (route: string) => (projectFlag ? route.replace(/^\/api\//, `/api/p/${encodeURIComponent(projectFlag)}/`) : route);
const [cmd, ...args] = argv;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

/** Calls a Cezane MCP tool through the server's /mcp endpoint, exactly like Claude does. */
async function tool(name: string, input: Record<string, unknown>) {
  const r = await fetch(`${base}${projectFlag ? p("/api/mcp") : "/mcp"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } }),
  });
  const j = (await r.json()) as {
    result?: { content: { type: string; text?: string; data?: string }[]; isError?: boolean };
    error?: { message: string };
  };
  if (j.error) throw new Error(j.error.message);
  let n = 0;
  for (const c of j.result?.content ?? []) {
    if (c.type === "text") console.log(c.text);
    else if (c.type === "image" && c.data) {
      n += 1;
      const out = resolve(outFlag ? outFlag.replace(/(\.\w+)?$/, n > 1 ? `-${n}$1` : "$1") : `tool-${name}-${n}.jpg`);
      writeFileSync(out, Buffer.from(c.data, "base64"));
      console.log(`[image] ${out}`);
    }
  }
  if (j.result?.isError) process.exitCode = 1;
}

async function waitFor(pred: (s: ServerState) => boolean, timeoutMs = 30 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const s = await api<ServerState>(p("/api/state"));
    if (pred(s)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error("timeout");
    await Bun.sleep(1000);
  }
}

/** Prints Claude's activity from the SSE stream until `until` matches. */
async function follow(until: (e: ClaudeEvent) => boolean) {
  const r = await fetch(`${base}${p("/api/events")}`);
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body!) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).replace(/^data: /, "");
      buf = buf.slice(i + 2);
      if (!line.startsWith("{")) continue;
      const e = JSON.parse(line) as ServerEvent;
      if (e.type !== "claude") continue;
      const ev = e.event;
      const detail = ev.kind === "tool" ? `${ev.tool} ${JSON.stringify(ev.input).slice(0, 160)}` : (ev.text ?? "").slice(0, 300);
      console.log(`[${ev.kind}] ${detail}${ev.costUsd !== undefined ? ` ($${ev.costUsd.toFixed(3)})` : ""}`);
      if (until(ev)) return;
    }
  }
}

const usage = `cezane — montage piloté par Claude
  cezane init <dir> [--name N]
  cezane serve [dir] [--port 4317] [--parallel N]  one server for every project; dir = default project
  cezane projects                             list the projects (with a running server)
  (project commands below take --project <id> to target another project than the default one)
  cezane import <files…> [--capture ios|web --target T]   (with a running server)
  cezane tool <name> '<json args>' [--out f]  call an MCP tool like Claude does
  cezane edit '<json ops>' [--reason r]
  cezane render [summary]                     render a version and wait
  cezane send [commentIds…]                   send draft comments to Claude and follow it
  cezane agent "<instruction>"                run Claude on the project and follow it
  cezane state`;

switch (cmd) {
  case "init": {
    const dir = resolve(args[0] ?? ".");
    if (!existsSync(resolve(dir, "cezane.json"))) ProjectStore.init(dir, nameFlag);
    const e = new ProjectRegistry().add(dir);
    console.log(`project ready: ${dir} (id ${e.id})`);
    break;
  }
  case "serve": {
    const hub = new Hub({ port, limits: parallelFlag ? { render: Number(parallelFlag) } : undefined });
    const given = args[0] ?? process.env.CEZANE_PROJECT;
    const app = given ? hub.setDefault(resolve(given), { name: nameFlag }) : hub.default();
    startHttp(hub, port);
    console.log(`cezane on ${base}: default project "${app.store.project.name}" (${app.id}), ${hub.registry.list().length} project(s) known, MCP ${base}/api/p/<id>/mcp`);
    const stop = async () => {
      await hub.stop();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    break;
  }
  case "projects": {
    for (const x of await api<ProjectSummary[]>("/api/projects"))
      console.log(`${x.isDefault ? "*" : " "} ${x.id.padEnd(16)} ${x.name.padEnd(28)} ${x.reels.map((r) => `${r.name}:${r.status}`).join(", ")}  ${x.missing ? "(dossier introuvable) " : ""}${x.path}`);
    break;
  }
  case "import": {
    const assets = await api<{ id: string; name: string; kind: string }[]>(p("/api/import"), { paths: args.map((p) => resolve(p)), capture: captureFlag, target: targetFlag });
    for (const a of assets) console.log(`${a.id} ${a.kind} ${a.name}`);
    const s = await waitFor((s) => s.project.assets.every((a) => a.status !== "ingesting"));
    for (const a of s.project.assets.filter((x) => assets.some((y) => y.id === x.id) && x.status === "error")) console.log(`error ${a.id}: ${a.error}`);
    break;
  }
  case "tool":
    await tool(args[0]!, args[1] ? (JSON.parse(args[1]) as Record<string, unknown>) : {});
    break;
  case "edit": {
    const r = await api<{ summary: string[]; revision: number }>(p("/api/edit"), { ops: JSON.parse(args[0]!), reason: reasonFlag });
    console.log(`rev ${r.revision}: ${r.summary.join("; ")}`);
    break;
  }
  case "render": {
    const v = await api<{ id: string }>(p("/api/render"), { summary: args.join(" ") || undefined });
    const s = await waitFor((s) => s.versions.find((x) => x.id === v.id)?.status !== "rendering");
    const done = s.versions.find((x) => x.id === v.id)!;
    if (done.status === "ready") console.log(`${done.id} ready in ${done.renderSeconds}s: ${resolve(s.dir, done.file!)} changed=${JSON.stringify(done.changed)}`);
    else {
      console.log(`${done.id} failed: ${done.error}`);
      process.exitCode = 1;
    }
    break;
  }
  case "send": {
    await api(p("/api/claude/send"), { commentIds: args.length ? args : undefined });
    await follow((e) => e.kind === "end" || e.kind === "error");
    process.exit(0);
  }
  case "agent": {
    await api(p("/api/claude/ask"), { text: args.join(" ") });
    await follow((e) => e.kind === "end" || e.kind === "error");
    process.exit(0);
  }
  case "state": {
    const s = await api<ServerState>(p("/api/state"));
    const summary = {
      id: s.projectId,
      project: s.project.name,
      revision: s.revision,
      assets: s.project.assets.map((a) => `${a.id} ${a.kind} ${a.status} ${a.name}`),
      versions: s.versions.map((v) => `${v.id}:${v.status}`),
      comments: s.comments.map((c) => `#${c.n} ${c.status}`),
      jobs: s.jobs.filter((j) => j.status !== "done").map((j) => `${j.label} ${j.status} ${Math.round(j.progress * 100)}% ${j.error ?? ""}`),
    };
    console.log(JSON.stringify(summary, null, 1));
    break;
  }
  default:
    console.log(usage);
}
