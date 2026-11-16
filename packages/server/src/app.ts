import { copyFileSync, existsSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import {
  type Anchor,
  type Asset,
  type ClaudeEvent,
  type Comment,
  type GenerateRequest,
  type Job,
  type ServerEvent,
  type ServerState,
  type Version,
  contentAnchorAt,
  montageDuration,
  newId,
} from "@cezane/core";
import { cutout, ffmpeg, generate as runGenerate, ingest, probe, RenderWorker, renderMontage, sha256File } from "@cezane/engine";
import { ClaudeRunner } from "./claude";
import { Jobs } from "./jobs";
import { now, ProjectStore } from "./store";

type Listener = (e: ServerEvent) => void;
type PermissionWaiter = { resolve: (r: { allow: boolean; message?: string }) => void };

/** Everything the HTTP API and the MCP tools act on. */
export class Cezane {
  readonly jobs: Jobs;
  readonly worker = new RenderWorker();
  readonly claude: ClaudeRunner;
  private listeners = new Set<Listener>();
  private permissions = new Map<string, PermissionWaiter>();
  private stateTimer?: ReturnType<typeof setTimeout>;
  /** Comments handled by the running Claude session, and the revision it started from. */
  private session?: { comments: string[]; fromRevision: number; render: boolean };

  constructor(
    readonly store: ProjectStore,
    readonly port: number,
  ) {
    this.jobs = new Jobs(() => this.changed());
    this.claude = new ClaudeRunner({
      dir: store.dir,
      port,
      model: store.project.settings.claudeModel,
      onEvent: (event) => this.broadcast({ type: "claude", event }),
      onEnd: (ok) => void this.onClaudeEnd(ok),
    });
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  // ───── events ─────

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  broadcast(e: ServerEvent) {
    for (const l of this.listeners) l(e);
  }
  changed() {
    clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => this.broadcast({ type: "state", state: this.state() }), 80);
  }

  state(): ServerState {
    const s = this.store;
    return {
      dir: s.dir,
      project: s.project,
      montage: s.montage,
      revision: s.revision,
      comments: s.comments,
      versions: s.versions,
      jobs: this.jobs.list,
      claude: { running: this.claude.running, task: this.claude.task, startedAt: this.claude.startedAt, model: s.project.settings.claudeModel },
    };
  }

  // ───── import & ingestion ─────

  async importFiles(paths: string[], provenance?: Asset["provenance"], opts: { wait?: boolean; name?: string; tags?: string[] } = {}): Promise<Asset[]> {
    const out: Asset[] = [];
    const waits: Promise<Job>[] = [];
    for (const raw of paths) {
      const src = resolve(raw);
      if (!existsSync(src)) throw new Error(`file not found: ${raw}`);
      const hash = await sha256File(src);
      const existing = this.store.project.assets.find((a) => a.hash === hash);
      if (existing) {
        out.push(existing);
        continue;
      }
      const info = await probe(src);
      const kind: Asset["kind"] = info.isImage ? "image" : info.hasVideo ? "video" : "audio";
      const file = join("media", `${hash}${extname(src).toLowerCase() || ".bin"}`);
      const dest = this.store.path(file);
      if (!existsSync(dest)) {
        try {
          linkSync(src, dest); // same volume: no extra disk space
        } catch {
          copyFileSync(src, dest);
        }
      }
      const asset: Asset = {
        id: newId("a"),
        kind,
        name: opts.name ?? basename(src, extname(src)),
        hash,
        file,
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        hasAudio: info.hasAudio,
        provenance: provenance ?? { type: "import", path: src },
        derived: {},
        status: "ingesting",
        tags: opts.tags ?? [],
        createdAt: now(),
      };
      this.store.project.assets.push(asset);
      this.store.saveProject();
      out.push(asset);
      waits.push(
        this.jobs.add("ingest", `Import · ${asset.name}`, async (update) => {
          try {
            const patch = await ingest(asset, dest, info, (p, label) => update(p, `${label} · ${asset.name}`));
            this.store.updateAsset(asset.id, patch);
          } catch (e) {
            this.store.updateAsset(asset.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
            throw e;
          }
          return { assetId: asset.id };
        }),
      );
    }
    this.changed();
    if (opts.wait) await Promise.all(waits);
    return out.map((a) => this.store.asset(a.id) ?? a);
  }

  // ───── rendering ─────

  private renderEnv() {
    return { worker: this.worker, projectDir: this.store.dir, assets: this.store.assetMap(), baseUrl: this.baseUrl };
  }

  /** Makes sure the person cutouts used by the montage exist (computed once per source). */
  private async ensureCutouts(update: (p: number, label?: string) => void) {
    const ids = new Set<string>();
    for (const t of this.store.montage.tracks) for (const c of t.clips) if (c.type === "media" && c.cutout) ids.add(c.assetId);
    for (const id of ids) {
      const a = this.store.asset(id);
      if (!a || a.derived.cutout || a.kind !== "video") continue;
      const name = await cutout(a, (p) => update(p * 0.3, `Détourage · ${a.name}`));
      this.store.updateAsset(id, { derived: { cutout: name } });
    }
  }

  /** Renders the current montage as a new version (V1, V2…). Only changed segments are rendered. */
  renderVersion(author: Version["author"], summary: string, commentIds: string[] = []): Version {
    const s = this.store;
    const n = (s.versions.at(-1)?.n ?? 0) + 1;
    const id = `v${n}`;
    const montageFile = join(".cezane/versions", `${id}.montage.json`);
    writeFileSync(s.path(montageFile), JSON.stringify(s.montage, null, 2));
    const version: Version = {
      id,
      n,
      montageId: s.montage.id,
      revision: s.revision,
      author,
      summary,
      status: "rendering",
      progress: 0,
      montageFile,
      durationFrames: montageDuration(s.montage),
      fps: s.montage.settings.fps,
      changed: [],
      comments: commentIds,
      segmentKeys: [],
      createdAt: now(),
    };
    s.versions.push(version);
    s.saveVersions();
    const prev = [...s.versions].reverse().find((v) => v.status === "ready");
    const montage = s.montage;
    void this.jobs.add("render", `Rendu ${id}`, async (update) => {
      try {
        await this.ensureCutouts(update);
        const env = this.renderEnv();
        const file = join(".cezane/renders", `${id}.mp4`);
        const r = await renderMontage(montage, env, s.path(file), prev?.segmentKeys ?? [], (p, label) => {
          version.progress = p;
          update(p, `Rendu ${id} · ${label}`);
        });
        const poster = join(".cezane/renders", `${id}.jpg`);
        await ffmpeg(["-ss", "0.5", "-i", s.path(file), "-frames:v", "1", "-vf", "scale=-2:640", "-q:v", "4", s.path(poster)]).catch(() => undefined);
        Object.assign(version, { status: "ready", progress: 1, file, poster, changed: prev ? r.changed : [], segmentKeys: r.keys, renderSeconds: +r.seconds.toFixed(1) });
        for (const c of s.comments) if (c.status === "fixed" && !c.fixedIn && commentIds.includes(c.id)) c.fixedIn = id;
        s.saveComments();
        console.log(`[render] ${id}: ${r.rendered}/${r.total} segments in ${r.seconds.toFixed(1)}s`);
        return { versionId: id };
      } catch (e) {
        Object.assign(version, { status: "error", error: e instanceof Error ? e.message : String(e) });
        throw e;
      } finally {
        s.saveVersions();
      }
    });
    this.changed();
    return version;
  }

  // ───── comments ─────

  addComment(anchor: Anchor, text: string, snapshotDataUrl?: string): Comment {
    const s = this.store;
    if (anchor.kind === "montage" && !anchor.content) {
      const m = s.versionMontage(anchor.versionId) ?? s.montage;
      anchor = { ...anchor, content: contentAnchorAt(m, anchor.frame) };
    }
    const id = newId("k");
    let snapshot: string | undefined;
    if (snapshotDataUrl?.startsWith("data:image/")) {
      snapshot = join(".cezane/comments", `${id}.jpg`);
      writeFileSync(s.path(snapshot), Buffer.from(snapshotDataUrl.split(",")[1] ?? "", "base64"));
    }
    const c: Comment = {
      id,
      n: (s.comments.reduce((m, x) => Math.max(m, x.n), 0) ?? 0) + 1,
      status: "draft",
      anchor,
      thread: [{ author: "user", text, at: now() }],
      snapshot,
      createdAt: now(),
    };
    s.comments.push(c);
    s.saveComments();
    this.changed();
    return c;
  }

  comment(id: string): Comment {
    const c = this.store.comments.find((x) => x.id === id || `#${x.n}` === id || String(x.n) === id);
    if (!c) throw new Error(`unknown comment ${id}`);
    return c;
  }

  // ───── Claude ─────

  sendToClaude(ids?: string[]) {
    const s = this.store;
    const batch = ids?.length ? ids.map((i) => this.comment(i)) : s.comments.filter((c) => c.status === "draft" || c.status === "reopened");
    if (!batch.length) throw new Error("no comment to send");
    for (const c of batch) c.status = "sent";
    s.saveComments();
    this.session = { comments: batch.map((c) => c.id), fromRevision: s.revision, render: true };
    const list = batch.map((c) => `${c.id} (#${c.n})`).join(", ");
    this.claude.start(`Handle these review comments on the montage: ${list}. Get their context with comment_context, fix them, then reply to each.`, `${batch.length} commentaire(s)`);
    this.changed();
  }

  ask(text: string) {
    this.session = { comments: [], fromRevision: this.store.revision, render: true };
    this.claude.start(text, text.slice(0, 80));
    this.changed();
  }

  private async onClaudeEnd(ok: boolean) {
    const session = this.session;
    this.session = undefined;
    const s = this.store;
    for (const id of session?.comments ?? []) {
      const c = s.comments.find((x) => x.id === id);
      if (c && (c.status === "sent" || c.status === "in_progress") && !ok) c.status = "draft";
    }
    s.saveComments();
    const rendering = s.versions.some((v) => v.status === "rendering" && v.revision === s.revision);
    if (session?.render && s.revision !== session.fromRevision && !rendering) {
      const journal = s.journal().filter((r) => r.rev > session.fromRevision);
      const summary = journal.map((r) => r.reason ?? r.summary.join(", ")).join(" · ").slice(0, 300);
      this.renderVersion("claude", summary || "Modifications de Claude", session.comments);
    }
    this.changed();
  }

  /** Permission requests (Claude's tools, paid generations) wait for the user in the UI. */
  requestPermission(text: string, tool: string, input: unknown): Promise<{ allow: boolean; message?: string }> {
    const permissionId = newId("p");
    const ev: ClaudeEvent = { id: newId("e"), at: now(), kind: "permission", permissionId, tool, input, text };
    this.claude.events.push(ev);
    this.broadcast({ type: "claude", event: ev });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.answerPermission(permissionId, false, "no answer from the user"), 10 * 60_000);
      this.permissions.set(permissionId, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      });
    });
  }

  answerPermission(id: string, allow: boolean, message?: string) {
    const w = this.permissions.get(id);
    if (!w) return false;
    this.permissions.delete(id);
    w.resolve({ allow, message });
    const ev: ClaudeEvent = { id: newId("e"), at: now(), kind: "permission_done", permissionId: id, ok: allow, text: message };
    this.claude.events.push(ev);
    this.broadcast({ type: "claude", event: ev });
    return true;
  }

  // ───── generation ─────

  async generate(req: GenerateRequest, opts: { askPermission?: boolean } = {}): Promise<Job> {
    const s = this.store;
    const { listModels } = await import("@cezane/engine");
    const model = (await listModels()).find((m) => m.provider === req.provider && m.id === req.model);
    if (!model) throw new Error(`unknown model ${req.provider}/${req.model}`);
    if (!model.available) throw new Error(`${model.label} unavailable: ${model.note ?? ""}`);
    if (model.costEur > 0) {
      const left = s.project.settings.budgetEur - s.project.settings.spentEur;
      if (model.costEur > left) throw new Error(`budget exceeded: ${model.costEur}€ needed, ${left.toFixed(2)}€ left`);
      if (opts.askPermission) {
        const r = await this.requestPermission(`Générer avec ${model.label} pour ~${model.costEur.toFixed(2)} € ?`, "generate", req);
        if (!r.allow) throw new Error(`refused by the user${r.message ? `: ${r.message}` : ""}`);
      } else if ((req.confirmCostEur ?? -1) < model.costEur) throw new Error(`confirm the cost (${model.costEur} €) first`);
    }
    const inputPaths = (req.inputs ?? []).map((id) => {
      const a = s.asset(id);
      const p = a && (s.cachePath(a, a.derived.normalized) ?? s.path(a.file));
      if (!p) throw new Error(`unknown input asset ${id}`);
      return a.kind === "video" ? (s.cachePath(a, a.derived.poster) ?? p) : p;
    });
    return this.jobs.add("generate", `${model.label} · ${req.prompt.slice(0, 40)}`, async (update, signal) => {
      const workDir = s.path(".cezane/generate", newId("g"));
      mkdirSync(workDir, { recursive: true });
      const out = await runGenerate({ ...req, inputPaths, workDir }, (p) => update(p), signal);
      s.project.settings.spentEur = +(s.project.settings.spentEur + out.costEur).toFixed(4);
      s.saveProject();
      if (out.text !== undefined) return { text: out.text };
      const [asset] = await this.importFiles(
        [out.file!],
        { type: "generated", provider: out.provider, model: out.model, prompt: req.prompt, inputs: req.inputs ?? [], settings: {}, cost: out.costEur },
        { wait: true, name: req.prompt.slice(0, 40) },
      );
      return { assetId: asset!.id };
    });
  }
}
