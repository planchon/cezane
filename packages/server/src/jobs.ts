import type { Job, SchedulerState } from "@cezane/core";
import { newId } from "@cezane/core";

export type Runner = (update: (progress: number, label?: string) => void, signal: AbortSignal) => Promise<Job["result"] | void>;
type Kind = Job["kind"];
type Waiting = { job: Job; run: Runner; resolve: (j: Job) => void };

/**
 * Global concurrency per kind, across every project. Renders: a small configurable number
 * (CEZANE_PARALLEL_RENDERS, default 2; the Remotion worker still renders one segment at a time,
 * the ffmpeg steps overlap). Captures drive the one simulator / one Chrome: always one at a time.
 */
export const DEFAULT_LIMITS: Record<Kind, number> = { render: 2, ingest: 2, generate: 3, capture: 1, cutout: 1 };
/** Per project: one render at a time (they share the project's segment cache). */
export const PER_PROJECT: Partial<Record<Kind, number>> = { render: 1 };

/** One job queue for the whole server; each project sees its own jobs through `Jobs`. */
export class Scheduler {
  readonly limits: Record<Kind, number>;
  private all: Job[] = [];
  private running = new Map<string, number>(); // kind, and `${projectId}:${kind}`
  private waiting: Waiting[] = [];
  private controllers = new Map<string, AbortController>();
  private listeners = new Map<string, () => void>(); // projectId → onChange
  /** Called on every change of any job (home tab). */
  onAnyChange: () => void = () => {};

  constructor(limits: Partial<Record<Kind, number>> = {}) {
    const env = Number(process.env.CEZANE_PARALLEL_RENDERS);
    this.limits = { ...DEFAULT_LIMITS, ...(env > 0 ? { render: env } : {}), ...limits, capture: 1 };
  }

  state(): SchedulerState {
    return { limits: this.limits, perProject: PER_PROJECT, jobs: this.all };
  }

  jobs(projectId?: string): Job[] {
    return projectId === undefined ? this.all : this.all.filter((j) => j.projectId === projectId);
  }

  listen(projectId: string, onChange: () => void) {
    this.listeners.set(projectId, onChange);
    return () => this.listeners.delete(projectId);
  }

  private notify(projectId?: string) {
    if (projectId) this.listeners.get(projectId)?.();
    this.onAnyChange();
  }

  add(projectId: string, kind: Kind, label: string, run: Runner): Promise<Job> {
    const job: Job = { id: newId("j"), projectId, kind, label, status: "queued", progress: 0, createdAt: new Date().toISOString() };
    this.all.push(job);
    this.trim();
    const done = new Promise<Job>((resolve) => this.waiting.push({ job, run, resolve }));
    this.pump();
    this.notify(projectId);
    return done;
  }

  /** Keeps every running/queued job and the last finished ones (per project). */
  private trim() {
    if (this.all.length <= 200) return;
    const keep = new Set<Job>();
    const perProject = new Map<string | undefined, number>();
    for (let i = this.all.length - 1; i >= 0; i--) {
      const j = this.all[i]!;
      const n = perProject.get(j.projectId) ?? 0;
      if (j.status === "running" || j.status === "queued" || n < 40) keep.add(j);
      perProject.set(j.projectId, n + 1);
    }
    this.all = this.all.filter((j) => keep.has(j));
  }

  cancel(id: string) {
    const w = this.waiting.find((x) => x.job.id === id);
    if (w) {
      this.waiting.splice(this.waiting.indexOf(w), 1);
      Object.assign(w.job, { status: "error", error: "cancelled" });
      w.resolve(w.job);
      this.notify(w.job.projectId);
      return;
    }
    this.controllers.get(id)?.abort();
  }

  /** Cancels a project's queued jobs and aborts its running ones (project closed). */
  cancelProject(projectId: string) {
    for (const j of this.jobs(projectId)) if (j.status === "queued" || j.status === "running") this.cancel(j.id);
  }

  private count = (key: string) => this.running.get(key) ?? 0;

  private pump() {
    for (const w of [...this.waiting]) {
      const { kind, projectId } = w.job;
      const pk = `${projectId}:${kind}`;
      if (this.count(kind) >= this.limits[kind]) continue;
      const per = PER_PROJECT[kind];
      if (per !== undefined && this.count(pk) >= per) continue;
      this.waiting.splice(this.waiting.indexOf(w), 1);
      this.running.set(kind, this.count(kind) + 1);
      this.running.set(pk, this.count(pk) + 1);
      void this.exec(w);
    }
  }

  private async exec({ job, run, resolve }: Waiting) {
    const ctrl = new AbortController();
    this.controllers.set(job.id, ctrl);
    job.status = "running";
    this.notify(job.projectId);
    let last = 0;
    try {
      const result = await run((p, label) => {
        job.progress = p;
        if (label) job.label = label;
        if (Date.now() - last > 250) {
          last = Date.now();
          this.notify(job.projectId);
        }
      }, ctrl.signal);
      job.status = "done";
      job.progress = 1;
      if (result) job.result = result;
    } catch (e) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : String(e);
      console.error(`[job ${job.kind}] ${job.error}`);
    } finally {
      this.controllers.delete(job.id);
      const pk = `${job.projectId}:${job.kind}`;
      this.running.set(job.kind, this.count(job.kind) - 1);
      this.running.set(pk, this.count(pk) - 1);
      this.notify(job.projectId);
      resolve(job);
      this.pump();
    }
  }
}

/** A project's view of the scheduler (the API the rest of the server already used). */
export class Jobs {
  constructor(
    private scheduler: Scheduler,
    private projectId: string,
  ) {}

  get list(): Job[] {
    return this.scheduler.jobs(this.projectId);
  }

  add(kind: Kind, label: string, run: Runner): Promise<Job> {
    return this.scheduler.add(this.projectId, kind, label, run);
  }

  cancel(id: string) {
    if (this.list.some((j) => j.id === id)) this.scheduler.cancel(id);
  }
}
