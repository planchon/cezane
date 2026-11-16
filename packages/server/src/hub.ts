import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Comment, Job, Project, ProjectsEvent, ProjectSummary, Version } from "@cezane/core";
import { REPO_DIR, RenderWorker } from "@cezane/engine";
import { Cezane } from "./app";
import { Scheduler } from "./jobs";
import { projectFileUrl, readMontage, reelSummaries } from "./reels";
import { ProjectRegistry, type RegistryEntry } from "./registry";
import { SettingsStore } from "./permissions";
import { ProjectStore } from "./store";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type HubOptions = {
  port: number;
  home?: string; // ~/Cezane (CEZANE_HOME)
  demos?: boolean | string[]; // register the repo demo projects (default: demo/*/ with a cezane.json)
  watch?: boolean; // folder watchers (default true)
  limits?: Partial<Record<Job["kind"], number>>;
  worker?: RenderWorker;
};

/** The repo's demo projects: demo/<name>/cezane.json. */
export function demoDirs(): string[] {
  const root = join(REPO_DIR, "demo");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "cezane.json")))
    .map((e) => join(root, e.name));
}

const readJson = <T>(p: string, fallback: T): T => {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
};
const mtime = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0);

/**
 * One server, every project: the registry, one job scheduler and one render worker (one Chrome)
 * shared by all, and the projects opened so far (loaded on first use: layout migration, folder
 * watcher, Claude runner). The default project answers the unscoped /api/… routes.
 */
export class Hub {
  readonly registry: ProjectRegistry;
  readonly scheduler: Scheduler;
  readonly worker: RenderWorker;
  /** ~/Cezane/settings.json: global settings (what Claude may do without asking). */
  readonly settings: SettingsStore;
  defaultId?: string;
  private apps = new Map<string, Cezane>();
  private projectListeners = new Set<(e: ProjectsEvent) => void>();
  private projectsTimer?: ReturnType<typeof setTimeout>;
  private lastProjects = "";
  private refreshedAt = 0;

  constructor(readonly opts: HubOptions) {
    const demos = opts.demos === false ? [] : Array.isArray(opts.demos) ? opts.demos : demoDirs();
    this.registry = new ProjectRegistry({ home: opts.home, demoDirs: demos });
    this.settings = new SettingsStore(this.registry.home);
    this.scheduler = new Scheduler(opts.limits);
    this.scheduler.onAnyChange = () => this.projectsChanged();
    this.worker = opts.worker ?? new RenderWorker();
  }

  get port() {
    return this.opts.port;
  }

  /** Makes `dir` the default project (created there when it has no cezane.json) and opens it. */
  setDefault(dir: string, opts: { name?: string } = {}): Cezane {
    const e = this.registry.add(dir, { init: true, name: opts.name });
    this.defaultId = e.id;
    return this.get(e.id);
  }

  /** The default project: the one given to `cezane serve`, else the most recently opened one. */
  default(): Cezane {
    if (this.defaultId && this.registry.get(this.defaultId)) return this.get(this.defaultId);
    const e = this.registry.list().find((x) => existsSync(join(x.path, "cezane.json"))) ?? this.registry.create("Nouveau projet");
    this.defaultId = e.id;
    return this.get(e.id);
  }

  loaded(id: string): Cezane | undefined {
    return this.apps.get(id);
  }

  /** A project by id, opened on first use. */
  get(id: string): Cezane {
    const open = this.apps.get(id);
    if (open) return open;
    const e = this.registry.get(id);
    if (!e) throw new HttpError(404, `unknown project ${id}`);
    if (!existsSync(join(e.path, "cezane.json"))) throw new HttpError(404, `project folder missing: ${e.path}`);
    const { store } = ProjectStore.open(e.path);
    const app = new Cezane(store, { id, port: this.port, scheduler: this.scheduler, worker: this.worker, watch: this.opts.watch, onChange: () => this.projectsChanged(), settings: this.settings });
    this.apps.set(id, app);
    this.registry.touch(id);
    this.projectsChanged();
    return app;
  }

  create(name: string): ProjectSummary {
    if (!name?.trim()) throw new HttpError(400, "name required");
    const e = this.registry.create(name);
    this.get(e.id);
    return this.summary(e.id);
  }

  open(path: string, init = false): ProjectSummary {
    if (!path?.trim()) throw new HttpError(400, "path required");
    let e: RegistryEntry;
    try {
      e = this.registry.add(path, { init });
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    this.get(e.id);
    return this.summary(e.id);
  }

  /** Closes a project and removes it from the list. Its folder is not touched. */
  forget(id: string) {
    const app = this.apps.get(id);
    app?.close();
    this.apps.delete(id);
    if (!this.registry.forget(id)) throw new HttpError(404, `unknown project ${id}`);
    if (this.defaultId === id) this.defaultId = undefined;
    this.projectsChanged();
  }

  // ───── summaries (home tab) ─────

  /** `fresh`: rescan ~/Cezane/Projets now (otherwise at most every 5 s). */
  summaries(fresh = true): ProjectSummary[] {
    if (fresh || Date.now() - this.refreshedAt > 5000) {
      this.registry.refresh();
      this.refreshedAt = Date.now();
    }
    return this.registry
      .list()
      .map((e) => this.summaryOf(e))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  summary(id: string): ProjectSummary {
    const e = this.registry.get(id);
    if (!e) throw new HttpError(404, `unknown project ${id}`);
    return this.summaryOf(e);
  }

  private summaryOf(e: RegistryEntry): ProjectSummary {
    const app = this.apps.get(e.id);
    const base = { id: e.id, path: e.path, location: e.location, loaded: Boolean(app), isDefault: e.id === this.defaultId };
    const projectFile = join(e.path, "cezane.json");
    if (!existsSync(projectFile)) return { ...base, name: basename(e.path), missing: true, modifiedAt: e.addedAt, reels: [], assets: 0 };
    const project = app?.store.project ?? readJson<Partial<Project>>(projectFile, {});
    const reels = app
      ? app.reels()
      : reelSummaries({
          projectId: e.id,
          dir: e.path,
          project,
          versions: readJson<Version[]>(join(e.path, "versions.json"), []),
          comments: readJson<Comment[]>(join(e.path, "comments.json"), []),
          montage: (id) => readMontage(e.path, id),
          activeId: readJson<{ id?: string }>(join(e.path, ".cezane/active-reel.json"), {}).id,
        });
    const icon = ["icon.png", "icon.jpg", "icon.jpeg", "icon.webp"].find((f) => existsSync(join(e.path, f)));
    const montagesDir = join(e.path, "montages");
    const stamps = [projectFile, join(e.path, "versions.json"), join(e.path, "comments.json")].map(mtime);
    if (existsSync(montagesDir)) for (const f of readdirSync(montagesDir)) if (f.endsWith(".json")) stamps.push(mtime(join(montagesDir, f)));
    const jobs = app ? this.scheduler.jobs(e.id) : [];
    return {
      ...base,
      name: project.name ?? basename(e.path),
      createdAt: project.createdAt,
      modifiedAt: new Date(Math.max(...stamps)).toISOString(),
      reels,
      assets: project.assets?.length ?? 0,
      claudeRunning: app?.claude.running,
      jobs: app ? { running: jobs.filter((j) => j.status === "running").length, queued: jobs.filter((j) => j.status === "queued").length } : undefined,
      iconUrl: projectFileUrl(e.id, icon),
    };
  }

  subscribeProjects(l: (e: ProjectsEvent) => void) {
    this.projectListeners.add(l);
    return () => this.projectListeners.delete(l);
  }

  /** Something shown on the home tab may have changed: tell its listeners (throttled, only real changes). */
  projectsChanged() {
    if (this.projectsTimer || !this.projectListeners.size) return;
    this.projectsTimer = setTimeout(() => {
      this.projectsTimer = undefined;
      const projects = this.summaries(false);
      const text = JSON.stringify(projects);
      if (text === this.lastProjects) return;
      this.lastProjects = text;
      for (const l of this.projectListeners) l({ type: "projects", projects });
    }, 1000);
  }

  async stop() {
    clearTimeout(this.projectsTimer);
    for (const app of this.apps.values()) app.close();
    this.apps.clear();
    await this.worker.stop(); // the worker closes Chrome before leaving
  }
}
