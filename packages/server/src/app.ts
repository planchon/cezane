import { copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type Anchor,
  type Asset,
  type ClaudeEvent,
  type Comment,
  type GenerateRequest,
  type Job,
  type Montage,
  type Op,
  type ReelSummary,
  type ServerEvent,
  type ServerState,
  type Version,
  contentAnchorAt,
  cutoutAssets,
  effectiveGrade,
  gradeFileKey,
  montageDuration,
  newId,
} from "@cezane/core";
import {
  CACHE_DIR,
  cacheDir,
  captureIos,
  captureSlug,
  captureWeb,
  counterName,
  CUTOUT_VERSION,
  cutout,
  eventsPath,
  ffmpeg,
  FOLDERS,
  gradeAsset,
  generate as runGenerate,
  ingest,
  nfc,
  probe,
  promptSlug,
  RenderLog,
  renderLog,
  type RenderWorker,
  renderMontage,
  safeFileName,
  sha256File,
  uniqueName,
  WATCHED_FOLDERS,
  type WebAction,
  withRenderLog,
} from "@cezane/engine";
import { ClaudeRunner } from "./claude";
import { cliSettings, decide, describeRequest, type PermissionContext, requestExample, SettingsStore } from "./permissions";
import { checkAssets, classifyFailure, clipsUsing, legacyFailure, missingMessage, readRenderLog, RenderFailureError, repairPrompt, usedAssets } from "./failures";
import { Jobs, type Scheduler } from "./jobs";
import { exportRender, fileNameFor, folderFor, linkOrCopy, readableName, reelSlug } from "./layout";
import { FolderSync } from "./library";
import { reelSummaries } from "./reels";
import { now, type ProjectStore } from "./store";
import { FolderWatcher } from "./watcher";

type Listener = (e: ServerEvent) => void;
type PermissionWaiter = { resolve: (r: { allow: boolean; message?: string }) => void; always?: { rules: string[]; example?: string } };

/** What a project shares with the others: the HTTP port, the job scheduler, the render worker. */
export type ProjectContext = {
  id: string;
  port: number;
  scheduler: Scheduler;
  worker: RenderWorker;
  watch?: boolean; // follow Rushes/, Générés/, Captures/ (default true)
  onChange?: () => void; // the project summary may have changed (home tab)
  settings?: SettingsStore; // ~/Cezane/settings.json: what Claude may do without asking (shared by every project)
};

export type CaptureRequest = {
  target: "web" | "ios";
  mode?: "screenshot" | "video";
  url?: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  seconds?: number;
  actions?: WebAction[];
  name?: string; // file name in Captures/ (default: from the URL, `rewind-codes-01.png`)
};

/** Everything the HTTP API and the MCP tools act on, for one project. */
export class Cezane {
  /** Command used to show a file in the Finder (tests replace it). */
  static revealCommand = ["open", "-R"];
  readonly id: string;
  readonly jobs: Jobs;
  readonly worker: RenderWorker;
  readonly claude: ClaudeRunner;
  readonly sync: FolderSync;
  readonly settings: SettingsStore;
  watcher?: FolderWatcher;
  private listeners = new Set<Listener>();
  private permissions = new Map<string, PermissionWaiter>();
  private stateTimer?: ReturnType<typeof setTimeout>;
  private offJobs: () => void;
  /** Files the server is writing into the watched folders (NFC, lowercase) → until when to ignore them. */
  private claims = new Map<string, number>();
  /** Files being imported in place right now (lowercase). */
  private importing = new Set<string>();
  private ingests = new Map<string, Promise<Job>>();
  /** The running Claude session: its reel (pinned when it started), the comments it handles, the revision it started from. */
  private session?: { montageId: string; comments: string[]; fromRevision: number; render: boolean; repair?: string };

  constructor(
    readonly store: ProjectStore,
    readonly ctx: ProjectContext,
  ) {
    this.id = ctx.id;
    this.worker = ctx.worker;
    this.jobs = new Jobs(ctx.scheduler, ctx.id);
    this.offJobs = ctx.scheduler.listen(ctx.id, () => this.changed());
    this.settings = ctx.settings ?? new SettingsStore();
    this.claude = new ClaudeRunner({
      dir: store.dir,
      mcpUrl: `${this.baseUrl}/api/p/${encodeURIComponent(ctx.id)}/mcp`,
      model: store.project.settings.claudeModel,
      onEvent: (event) => this.broadcast({ type: "claude", event }),
      onEnd: (ok) => void this.onClaudeEnd(ok),
      settings: () => cliSettings(this.settings.permissions(), this.permissionContext()),
    });
    this.sync = new FolderSync(this);
    if (ctx.watch !== false) {
      this.watcher = new FolderWatcher(store.dir, () => void this.sync.sync().catch((e) => console.error(`[watch] ${store.dir}: ${e}`)));
      this.watcher.start();
    }
  }

  get port() {
    return this.ctx.port;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Stops the watcher and Claude, cancels the project's jobs (project closed or server stopping). */
  close() {
    this.watcher?.stop();
    this.claude.stop();
    this.ctx.scheduler.cancelProject(this.id);
    this.offJobs();
    clearTimeout(this.stateTimer);
    this.listeners.clear();
  }

  // ───── the project folders ─────

  /** Path relative to the project ("/"-separated, NFC) when `abs` is inside a watched folder. */
  relInFolders(abs: string): string | undefined {
    const real = (p: string) => {
      try {
        return nfc(realpathSync(p));
      } catch {
        return nfc(resolve(p));
      }
    };
    const r = relative(real(this.store.dir), real(abs));
    if (!r || r.startsWith("..") || isAbsolute(r)) return undefined;
    const rel = r.split(sep).join("/");
    return WATCHED_FOLDERS.some((f) => rel.startsWith(`${f}/`)) ? rel : undefined;
  }

  /** Marks a file the server is about to write, so the watcher does not import it on its own. */
  claim(rel: string, ms = 30_000) {
    this.claims.set(nfc(rel).toLowerCase(), Date.now() + ms);
  }

  /** True while the server itself is writing or importing this file. */
  isBusy(rel: string): boolean {
    const k = nfc(rel).toLowerCase();
    if (this.importing.has(k)) return true;
    const until = this.claims.get(k);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.claims.delete(k);
    return false;
  }

  /** Resolves when the asset's ingestion job is over (immediately if none is running). */
  async waitIngest(assetId: string) {
    await this.ingests.get(assetId);
  }

  /** Shows a project file in the Finder (`open -R`). Nothing: the project folder itself. */
  reveal(target: { path?: string; assetId?: string; versionId?: string } = {}): string {
    const s = this.store;
    const fail = (status: number, msg: string) => Object.assign(new Error(msg), { status });
    let rel = target.path ?? "";
    if (target.assetId) {
      const a = s.asset(target.assetId);
      if (!a) throw fail(404, `unknown asset ${target.assetId}`);
      rel = a.file;
    } else if (target.versionId) {
      const v = s.versions.find((x) => x.id === target.versionId);
      const file = v?.exportFile && existsSync(s.path(v.exportFile)) ? v.exportFile : v?.file;
      if (!file) throw fail(404, `no render for ${target.versionId}`);
      rel = file;
    }
    const root = resolve(s.dir);
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) throw fail(403, "outside the project");
    if (!existsSync(abs)) throw fail(404, `not found: ${rel}`);
    Bun.spawn([...Cezane.revealCommand, abs], { stdout: "ignore", stderr: "ignore" });
    return abs;
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
    this.stateTimer = setTimeout(() => {
      this.broadcast({ type: "state", state: this.state() });
      this.ctx.onChange?.();
    }, 80);
  }

  changedFiles() {
    this.broadcast({ type: "files", projectId: this.id });
  }

  /** The project as the UI sees it: the selected reel (montage, revision, versions, comments) and the list of reels. */
  state(): ServerState {
    const s = this.store;
    const running = this.claude.running;
    return {
      projectId: this.id,
      dir: s.dir,
      project: s.project,
      montage: s.montage,
      revision: s.revision,
      comments: s.reelComments(),
      versions: s.reelVersions(),
      jobs: this.jobs.list,
      claude: {
        running,
        task: this.claude.task,
        startedAt: this.claude.startedAt,
        model: s.project.settings.claudeModel,
        montageId: running ? this.session?.montageId : undefined,
        repairing: running ? this.session?.repair : undefined,
      },
      reels: this.reels(),
    };
  }

  reels(): ReelSummary[] {
    const s = this.store;
    return reelSummaries({
      projectId: this.id,
      dir: s.dir,
      project: s.project,
      versions: s.versions,
      comments: s.comments,
      montage: (id) => s.montages().find((m) => m.id === id),
      activeId: s.activeId,
      claudeOn: this.claude.running ? this.session?.montageId : undefined,
    });
  }

  // ───── reels ─────

  /** Selects the reel the UI, the unscoped routes and new Claude sessions act on. */
  selectReel(id: string) {
    this.store.select(id);
    this.changed();
  }

  createReel(name: string, select = true): ReelSummary {
    const n = name.trim();
    if (!n) throw Object.assign(new Error("name required"), { status: 400 });
    const r = this.store.createReel(n);
    if (select) this.store.select(r.id);
    this.changed();
    return this.reels().find((x) => x.id === r.id)!;
  }

  renameReel(id: string, name: string): ReelSummary {
    const n = name.trim();
    if (!n) throw Object.assign(new Error("name required"), { status: 400 });
    this.store.renameReel(id, n);
    this.changed();
    return this.reels().find((x) => x.id === id)!;
  }

  // ───── import & ingestion ─────

  /**
   * Imports files as assets. A file already in Rushes/, Générés/ or Captures/ is used where it is;
   * any other file is linked (or copied) into the folder of its provenance under a readable name:
   * imports keep their original name ("plage 2.mov" on a collision), captures their name or target.
   * `events`: interaction log of a screen recording (default: `<file>.events.json` next to it).
   */
  async importFiles(paths: string[], provenance?: Asset["provenance"], opts: { wait?: boolean; name?: string; tags?: string[]; events?: string } = {}): Promise<Asset[]> {
    const out: Asset[] = [];
    const waits: Promise<Job>[] = [];
    const s = this.store;
    for (const raw of paths) {
      const src = resolve(raw);
      if (!existsSync(src)) throw new Error(`file not found: ${raw}`);
      const inPlace = this.relInFolders(src);
      const key = inPlace && nfc(inPlace).toLowerCase();
      if (key) this.importing.add(key);
      try {
        const hash = await sha256File(src);
        const twin = () => s.project.assets.find((a) => a.hash === hash);
        if (twin()) {
          out.push(twin()!);
          continue;
        }
        const info = await probe(src);
        if (twin()) {
          out.push(twin()!); // imported meanwhile (watcher, double click)
          continue;
        }
        const kind: Asset["kind"] = info.isImage ? "image" : info.hasVideo ? "video" : "audio";
        const prov: Asset["provenance"] = provenance ?? { type: "import", path: src };
        // A screen recording can come with its interaction log (capture.events.json next to capture.webm).
        const sidecar = opts.events ?? src.replace(/\.[^.]+$/, ".events.json");
        const derived: Asset["derived"] = {};
        if (kind === "video" && existsSync(sidecar)) {
          copyFileSync(sidecar, join(cacheDir(hash), "events.json"));
          derived.events = "events.json";
        }
        let file = inPlace;
        if (!file) {
          const folder = folderFor(prov);
          const dir = s.path(folder);
          mkdirSync(dir, { recursive: true });
          file = `${folder}/${fileNameFor({ name: opts.name ?? basename(src, extname(src)), provenance: prov }, extname(src) || ".bin", dir)}`;
          this.claim(file);
          linkOrCopy(src, s.path(file)); // same volume: a hard link, no extra disk space
        }
        const dest = s.path(file);
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
          provenance: prov,
          derived,
          status: "ingesting",
          tags: opts.tags ?? [],
          createdAt: now(),
        };
        s.project.assets.push(asset);
        s.saveProject();
        out.push(asset);
        const job = this.jobs.add("ingest", `Import · ${asset.name}`, async (update) => {
          try {
            const patch = await ingest(asset, dest, info, (p, label) => update(p, `${label} · ${asset.name}`));
            s.updateAsset(asset.id, patch);
          } catch (e) {
            s.updateAsset(asset.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
            throw e;
          }
          return { assetId: asset.id };
        });
        this.ingests.set(asset.id, job);
        void job.then(() => this.ingests.delete(asset.id));
        waits.push(job);
      } finally {
        if (key) this.importing.delete(key);
      }
    }
    this.changed();
    if (out.length) this.changedFiles();
    if (opts.wait) await Promise.all(waits);
    return out.map((a) => s.asset(a.id) ?? a);
  }

  /** Writes uploaded files straight into Rushes/ (original names, " 2" on collisions), then imports them. */
  async importUploads(files: File[]): Promise<Asset[]> {
    const dir = this.store.path(FOLDERS.rushes);
    mkdirSync(dir, { recursive: true });
    const paths: string[] = [];
    for (const f of files) {
      const name = uniqueName(dir, f.name || "rush");
      this.claim(`${FOLDERS.rushes}/${name}`);
      await Bun.write(join(dir, name), f);
      paths.push(join(dir, name));
    }
    return this.importFiles(paths);
  }

  /**
   * Captures the iOS simulator or a web page into Captures/ (readable name) and imports it.
   * Captures go through the scheduler: one at a time across all projects (one simulator, one Chrome).
   * The job ends when the file is imported; ingestion runs as its own job (see waitIngest).
   */
  capture(o: CaptureRequest): Promise<Job> {
    const s = this.store;
    if (o.target === "web" && !o.url) return Promise.reject(new Error("url required"));
    const label = `Capture ${o.target === "web" ? o.url : "simulateur"}`;
    return this.jobs.add("capture", label, async () => {
      const mode = o.mode ?? "screenshot";
      const ext = mode === "video" ? (o.target === "web" ? ".webm" : ".mov") : ".png";
      mkdirSync(s.path(".cezane/tmp"), { recursive: true });
      const tmp = s.path(".cezane/tmp", `capture-${newId("c")}${ext}`);
      if (o.target === "web") await captureWeb({ url: o.url!, out: tmp, width: o.width, height: o.height, fullPage: o.fullPage, actions: o.actions });
      else await captureIos({ out: tmp, seconds: o.seconds });
      const target = o.url ?? "simulator";
      const dir = s.path(FOLDERS.captures);
      mkdirSync(dir, { recursive: true });
      const name = readableName(o.name) ? uniqueName(dir, `${safeFileName(o.name)}${ext}`) : counterName(dir, captureSlug(target), ext);
      const rel = `${FOLDERS.captures}/${name}`;
      this.claim(rel);
      renameSync(tmp, s.path(rel));
      const events = eventsPath(tmp);
      const [a] = await this.importFiles([s.path(rel)], { type: "capture", source: o.target, target }, { name: basename(name, ext), events: existsSync(events) ? events : undefined });
      if (existsSync(events)) unlinkSync(events);
      return { assetId: a!.id };
    });
  }

  // ───── rendering ─────

  private renderEnv() {
    return { worker: this.worker, projectDir: this.store.dir, assets: this.store.assetMap(), baseUrl: this.baseUrl };
  }

  /**
   * Makes sure the person cutouts used by the montage exist (cutout clips and the main track under
   * `behind` graphics), with their subject track. Computed once per source.
   */
  async ensureCutouts(update: (p: number, label?: string) => void = () => {}, montage: Montage = this.store.montage) {
    for (const id of cutoutAssets(montage)) {
      const a = this.store.asset(id);
      if (!a || a.kind !== "video" || (a.derived.cutout?.startsWith(`cutout-v${CUTOUT_VERSION}-`) && a.derived.subject)) continue;
      const r = await cutout(a, (p) => update(p * 0.3, `Détourage · ${a.name}`));
      this.store.updateAsset(id, { derived: { cutout: r.cutout, subject: r.subject } });
    }
  }

  /** Makes sure the graded copies (LUT) of the footage used by the montage exist, video and cutout. */
  async ensureGrades(update: (p: number, label?: string) => void = () => {}, montage: Montage = this.store.montage) {
    const m = montage;
    for (const t of m.tracks)
      for (const c of t.clips) {
        if (c.type !== "media") continue;
        const a = this.store.asset(c.assetId);
        if (!a || a.kind === "audio") continue;
        const g = effectiveGrade(c, m.settings, a.provenance.type === "import");
        if (!g) continue;
        const key = gradeFileKey(g);
        const have = a.derived.graded?.[key];
        const cutoutOk = !a.derived.cutout || have?.cutout?.includes(a.derived.cutout.replace(/\.webm$/, ""));
        if (have && cutoutOk && existsSync(join(CACHE_DIR, a.hash, have.file))) continue;
        update(0, `Étalonnage · ${a.name} · ${g.lut}`);
        const r = await gradeAsset(a, g, this.store.dir);
        this.store.updateAsset(a.id, { derived: { graded: { ...(a.derived.graded ?? {}), [key]: r } } });
      }
  }

  /**
   * Renders a reel (the selected one by default) as a new version (V1, V2… per reel; ids stay unique
   * in the project). Only changed segments are rendered.
   */
  renderVersion(author: Version["author"], summary: string, commentIds: string[] = [], reelId = this.store.activeId): Version {
    const s = this.store;
    const reel = s.reel(reelId);
    const { id, n } = s.nextVersion(reelId);
    const montageFile = join(".cezane/versions", `${id}.montage.json`);
    writeFileSync(s.path(montageFile), JSON.stringify(reel.montage, null, 2));
    const version: Version = {
      id,
      n,
      montageId: reel.id,
      revision: reel.revision,
      author,
      summary,
      status: "rendering",
      progress: 0,
      montageFile,
      durationFrames: montageDuration(reel.montage),
      fps: reel.montage.settings.fps,
      changed: [],
      comments: commentIds,
      segmentKeys: [],
      createdAt: now(),
    };
    s.versions.push(version);
    s.saveVersions();
    this.queueRender(version, reel.montage);
    this.changed();
    return version;
  }

  /**
   * Renders a version (a new one, or a failed one again) through the scheduler. What the render
   * prints goes to .cezane/renders/<id>.log; a failure is classified and kept on the version.
   */
  private queueRender(version: Version, montage: Montage) {
    const s = this.store;
    const { id, n } = version;
    const commentIds = version.comments;
    const prev = [...s.reelVersions(s.reelOf(version.montageId))].reverse().find((v) => v.status === "ready" && v.id !== id);
    const log = new RenderLog(s.path(".cezane/renders", `${id}.log`));
    log.line(`Rendu V${n} (${id}) · révision ${version.revision} · ${now()}`);
    log.flush();
    const job = this.jobs.add(
      "render",
      `Rendu V${n}`,
      (update) =>
        withRenderLog(log, async () => {
          try {
            await this.prepareAssets(montage, update);
            await this.ensureCutouts(update, montage);
            await this.ensureGrades(update, montage);
            const env = this.renderEnv();
            const file = join(".cezane/renders", `${id}.mp4`);
            const r = await renderMontage(montage, env, s.path(file), prev?.segmentKeys ?? [], (p, label) => {
              version.progress = p;
              update(p, `Rendu V${n} · ${label}`);
            });
            const poster = join(".cezane/renders", `${id}.jpg`);
            await ffmpeg(["-ss", "0.5", "-i", s.path(file), "-frames:v", "1", "-vf", "scale=-2:640", "-q:v", "4", s.path(poster)]).catch(() => undefined);
            Object.assign(version, { status: "ready", progress: 1, file, poster, changed: prev ? r.changed : [], segmentKeys: r.keys, renderSeconds: +r.seconds.toFixed(1) });
            try {
              version.exportFile = exportRender(s.dir, file, this.reelSlug(montage.id), n);
              this.changedFiles();
            } catch (e) {
              console.error(`[export] ${id}: ${e instanceof Error ? e.message : e}`);
            }
            for (const c of s.comments) if (c.status === "fixed" && !c.fixedIn && commentIds.includes(c.id)) c.fixedIn = id;
            s.saveComments();
            log.line(`Terminé : ${r.rendered}/${r.total} segments en ${r.seconds.toFixed(1)} s`);
            console.log(`[render] ${id}: ${r.rendered}/${r.total} segments in ${r.seconds.toFixed(1)}s`);
            return { versionId: id };
          } catch (e) {
            this.failVersion(version, e, montage, log);
            throw e;
          } finally {
            log.flush();
            s.saveVersions();
          }
        }),
      { montageId: version.montageId },
    );
    // Cancelled before it started (project closed): this render is not coming.
    void job.then((j) => {
      if (version.status !== "rendering") return;
      this.failVersion(version, new RenderFailureError("interrupted", j.error ?? "cancelled"), montage, log);
      log.flush();
      s.saveVersions();
      this.changed();
    });
  }

  /**
   * Before a render: waits for the ingestion of the assets it uses, stops at once when a file is
   * gone with its cache (only the user can bring it back), and rebuilds a cache that was cleared
   * from the original file.
   */
  private async prepareAssets(montage: Montage, update: (p: number, label?: string) => void) {
    const s = this.store;
    for (const a of usedAssets(montage, s.project.assets)) if (a.status === "ingesting") await this.waitIngest(a.id);
    const { missing, stale } = checkAssets(montage, s.project.assets, s.dir);
    if (missing.length) {
      for (const a of missing) renderLog()?.line(`Introuvable : ${a.file} (et sa copie en cache ${a.hash})`);
      // Flagged as the watcher does: the Médias view lists them, and the flag drops when the file is back.
      if (missing.some((a) => !a.missing)) {
        for (const a of missing) a.missing = true;
        s.saveProject();
        this.changedFiles();
      }
      throw new RenderFailureError("missing", missingMessage(missing), missing.map((a) => a.id));
    }
    for (const a of stale) {
      renderLog()?.line(`Cache absent pour ${a.file} : reconstruction depuis le fichier`);
      update(0, `Import · ${a.name}`);
      const path = s.path(a.file);
      s.updateAsset(a.id, await ingest(a, path, await probe(path), (p, label) => update(p * 0.2, `${label} · ${a.name}`), { transcribe: false }));
    }
  }

  /** Marks a version failed, with the classified cause (see failures.ts). */
  private failVersion(version: Version, e: unknown, montage: Montage, log: RenderLog) {
    const s = this.store;
    // A cause the render diagnosed itself needs no stack; anything else keeps it (for Claude and for us).
    log.line(`Erreur : ${e instanceof RenderFailureError || !(e instanceof Error) ? String(e instanceof Error ? e.message : e) : (e.stack ?? e.message)}`);
    const missing = e instanceof RenderFailureError ? [] : checkAssets(montage, s.project.assets, s.dir).missing;
    const failure = classifyFailure({ error: e, missing, logTail: log.tail() });
    Object.assign(version, { status: "error", error: failure.message, failure });
    console.error(`[render] ${version.id} failed (${failure.kind}): ${failure.message}`);
  }

  private failedVersion(id: string): Version {
    const v = this.store.versions.find((x) => x.id === id);
    if (!v) throw Object.assign(new Error(`unknown version ${id}`), { status: 404 });
    if (v.status !== "error") throw Object.assign(new Error(`V${v.n} has not failed`), { status: 409 });
    return v;
  }

  /** Renders a failed version again, in place (same number, same frozen montage). */
  retryVersion(id: string): Version {
    const s = this.store;
    const v = this.failedVersion(id);
    const montage = s.versionMontage(id);
    if (!montage) throw Object.assign(new Error(`V${v.n} has no montage`), { status: 404 });
    Object.assign(v, { status: "rendering", progress: 0, error: undefined, failure: undefined, createdAt: now() });
    s.saveVersions();
    this.queueRender(v, montage);
    this.changed();
    return v;
  }

  /**
   * Removes from the reel's current montage the clips that use these assets (default: the files the
   * failed version could not find), as one revision. The UI then offers a new render.
   */
  removeClipsOf(id: string, assetIds?: string[]): { removed: number; revision: number } {
    const s = this.store;
    const v = s.versions.find((x) => x.id === id);
    if (!v) throw Object.assign(new Error(`unknown version ${id}`), { status: 404 });
    const ids = assetIds?.length ? assetIds : (v.failure?.assetIds ?? []);
    if (!ids.length) throw Object.assign(new Error("no asset to remove"), { status: 400 });
    const reel = s.reel(s.reelOf(v.montageId));
    const clips = clipsUsing(reel.montage, ids);
    if (!clips.length) return { removed: 0, revision: reel.revision };
    const names = ids.map((x) => s.asset(x)?.file.split("/").at(-1) ?? x).join(", ");
    const ops: Op[] = clips.map((c) => ({ op: "remove_clip", id: c.id, ripple: false }));
    const r = reel.edit(ops, "user", `Plans retirés (${names} introuvable)`);
    this.changed();
    return { removed: clips.length, revision: r.revision };
  }

  /** The render log of a version (its end). */
  versionLog(id: string): string {
    const v = this.store.versions.find((x) => x.id === id);
    if (!v) throw Object.assign(new Error(`unknown version ${id}`), { status: 404 });
    return readRenderLog(this.store.dir, id) || v.failure?.logTail || "";
  }

  /**
   * Asks Claude to repair a failed render: a session on the version's reel, with the error and the
   * end of the render log. When it ends, the reel is rendered again (a new version when Claude
   * changed the montage, else this one again).
   */
  repairWithClaude(id: string) {
    const s = this.store;
    const v = this.failedVersion(id);
    if (this.claude.running) throw Object.assign(new Error("Claude is already working"), { status: 409 });
    const reel = s.reel(s.reelOf(v.montageId));
    const failure = v.failure ?? legacyFailure(v, s.dir);
    const prompt = repairPrompt({ version: v, failure, log: readRenderLog(s.dir, id, 8000), revisionNow: reel.revision });
    this.session = { montageId: reel.id, comments: [], fromRevision: reel.revision, render: true, repair: v.id };
    this.claude.start(prompt, `Réparer le rendu V${v.n}`, undefined, this.mcpUrl(reel.id));
    this.changed();
  }

  reelSlug(montageId: string): string {
    const s = this.store;
    return reelSlug(s.project.name, s.project.montages.find((m) => m.id === montageId)?.name ?? (s.montage.id === montageId ? s.montage.name : undefined));
  }

  /** Links a ready render into Exports/ again (after it was deleted there, or for an old version). */
  exportVersion(id: string): Version {
    const s = this.store;
    const v = s.versions.find((x) => x.id === id);
    if (!v) throw Object.assign(new Error("unknown version"), { status: 404 });
    if (v.status !== "ready" || !v.file || !existsSync(s.path(v.file))) throw new Error(`${id} has no render`);
    if (!v.exportFile || !existsSync(s.path(v.exportFile))) {
      v.exportFile = exportRender(s.dir, v.file, this.reelSlug(v.montageId), v.n);
      s.saveVersions();
      this.changed();
      this.changedFiles();
    }
    return v;
  }

  // ───── comments ─────

  addComment(anchor: Anchor, text: string, snapshotDataUrl?: string): Comment {
    const s = this.store;
    if (anchor.kind === "montage" && !anchor.content) {
      const m = s.versionMontage(anchor.versionId) ?? s.reel(s.reelOf(anchor.montageId)).montage;
      anchor = { ...anchor, content: contentAnchorAt(m, anchor.frame) };
    }
    // Numbers count per reel (#1, #2…); canvas comments have their own count.
    const scope = (a: Anchor) => (a.kind === "canvas" ? "canvas" : s.reelOf(a.montageId));
    const mine = scope(anchor);
    const id = newId("k");
    let snapshot: string | undefined;
    if (snapshotDataUrl?.startsWith("data:image/")) {
      snapshot = join(".cezane/comments", `${id}.jpg`);
      writeFileSync(s.path(snapshot), Buffer.from(snapshotDataUrl.split(",")[1] ?? "", "base64"));
    }
    const c: Comment = {
      id,
      n: s.comments.filter((x) => scope(x.anchor) === mine).reduce((m, x) => Math.max(m, x.n), 0) + 1,
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

  /** A comment by id, or by number (#3) among the reel's comments first (the selected reel by default). */
  comment(id: string, reelId = this.store.activeId): Comment {
    const s = this.store;
    const byNumber = (x: Comment) => `#${x.n}` === id || String(x.n) === id;
    const c = s.comments.find((x) => x.id === id) ?? s.reelComments(reelId).find(byNumber) ?? s.comments.find(byNumber);
    if (!c) throw new Error(`unknown comment ${id}`);
    return c;
  }

  /** The MCP endpoint of this project, pinned to a reel. */
  mcpUrl(reelId: string) {
    return `${this.baseUrl}/api/p/${encodeURIComponent(this.id)}/mcp?reel=${encodeURIComponent(reelId)}`;
  }

  // ───── Claude ─────

  /** Sends review comments to Claude, on the selected reel (the session stays on it if the user switches reels). */
  sendToClaude(ids?: string[]) {
    const s = this.store;
    if (this.claude.running) throw new Error("Claude is already working");
    const reel = s.reel();
    const batch = ids?.length ? ids.map((i) => this.comment(i)) : s.reelComments(reel.id).filter((c) => c.status === "draft" || c.status === "reopened");
    if (!batch.length) throw new Error("no comment to send");
    for (const c of batch) c.status = "sent";
    s.saveComments();
    this.session = { montageId: reel.id, comments: batch.map((c) => c.id), fromRevision: reel.revision, render: true };
    const list = batch.map((c) => `${c.id} (#${c.n})`).join(", ");
    this.claude.start(`Handle these review comments on the montage: ${list}. Get their context with comment_context, fix them, then reply to each.`, `${batch.length} commentaire(s)`, undefined, this.mcpUrl(reel.id));
    this.changed();
  }

  ask(text: string) {
    if (this.claude.running) throw new Error("Claude is already working");
    const reel = this.store.reel();
    this.session = { montageId: reel.id, comments: [], fromRevision: reel.revision, render: true };
    this.claude.start(text, text.slice(0, 80), undefined, this.mcpUrl(reel.id));
    this.changed();
  }

  private async onClaudeEnd(ok: boolean) {
    // Cards still waiting belong to the session that just ended: close them so they leave the UI.
    for (const id of [...this.permissions.keys()]) this.answerPermission(id, false, "session terminée");
    const session = this.session;
    this.session = undefined;
    const s = this.store;
    for (const id of session?.comments ?? []) {
      const c = s.comments.find((x) => x.id === id);
      if (c && (c.status === "sent" || c.status === "in_progress") && !ok) c.status = "draft";
    }
    s.saveComments();
    const reel = session && s.project.montages.some((m) => m.id === session.montageId) ? s.reel(session.montageId) : undefined;
    const rendering = reel && s.reelVersions(reel.id).some((v) => v.status === "rendering" && v.revision === reel.revision);
    if (session?.render && reel && reel.revision !== session.fromRevision && !rendering) {
      const journal = reel.journal().filter((r) => r.rev > session.fromRevision);
      const summary = journal.map((r) => r.reason ?? r.summary.join(", ")).join(" · ").slice(0, 300);
      this.renderVersion("claude", summary || "Modifications de Claude", session.comments, reel.id);
    } else if (ok && session?.repair && reel && !rendering) {
      // A repair that changed nothing (the montage was not the cause): the same version again.
      const v = s.versions.find((x) => x.id === session.repair);
      if (v?.status === "error") this.retryVersion(v.id);
    }
    this.changed();
  }

  permissionContext(): PermissionContext {
    return this.settings.context(this.store.dir);
  }

  /**
   * What Claude Code asks about (the `approve` MCP tool): allowed at once when the settings cover it
   * (the CLI rules should have, or a rule was added during the session), else a card in the UI.
   */
  async approve(tool: string, input: Record<string, unknown>): Promise<{ allow: boolean; message?: string }> {
    const ctx = this.permissionContext();
    const d = decide(this.settings.permissions(), ctx, tool, input);
    if (d.allow) {
      console.log(`[approve] ${this.id}: ${tool} allowed (${d.why})`);
      return { allow: true };
    }
    return this.requestPermission(describeRequest(tool, input, ctx), tool, input, { paid: d.paid, alwaysRules: d.alwaysRules, example: requestExample(tool, input, ctx) });
  }

  /**
   * Permission requests (Claude's tools, paid generations) wait for the user in the UI. `alwaysRules`:
   * what "Toujours autoriser" saves; never offered for spending (`paid`).
   */
  requestPermission(text: string, tool: string, input: unknown, opts: { paid?: boolean; alwaysRules?: string[]; example?: string } = {}): Promise<{ allow: boolean; message?: string }> {
    const permissionId = newId("p");
    const alwaysRules = !opts.paid && opts.alwaysRules?.length ? opts.alwaysRules : undefined;
    const ev: ClaudeEvent = { id: newId("e"), at: now(), kind: "permission", permissionId, tool, input, text, ...(alwaysRules ? { alwaysRules } : {}), ...(opts.paid ? { paid: true } : {}) };
    this.claude.events.push(ev);
    this.broadcast({ type: "claude", event: ev });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.answerPermission(permissionId, false, "no answer from the user"), 10 * 60_000);
      this.permissions.set(permissionId, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        always: alwaysRules && { rules: alwaysRules, example: opts.example },
      });
    });
  }

  /** `always`: also save the request's rules ("Toujours autoriser"; ignored for spending). */
  answerPermission(id: string, allow: boolean, message?: string, always = false) {
    const w = this.permissions.get(id);
    if (!w) return false;
    this.permissions.delete(id);
    if (allow && always && w.always) {
      this.settings.addRules(w.always.rules, w.always.example);
      message ??= `Toujours autorisé : ${w.always.rules.join(", ")}`;
    }
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
        const r = await this.requestPermission(`Générer avec ${model.label} pour ~${model.costEur.toFixed(2)} € ?`, "generate", req, { paid: true });
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
      // The result lands straight in Générés/ as `<prompt-slug>-01.png`.
      const dest = { dir: s.path(FOLDERS.generated), slug: promptSlug(req.prompt), claim: (name: string) => this.claim(`${FOLDERS.generated}/${name}`) };
      const out = await runGenerate({ ...req, inputPaths, workDir, out: dest }, (p) => update(p), signal).finally(() => rmSync(workDir, { recursive: true, force: true }));
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
