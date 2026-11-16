import type { Job } from "@cezane/core";
import { newId } from "@cezane/core";

type Runner = (update: (progress: number, label?: string) => void, signal: AbortSignal) => Promise<Job["result"] | void>;

const LIMITS: Record<Job["kind"], number> = { render: 1, ingest: 2, generate: 3, capture: 1, cutout: 1 };

/** Background jobs with a concurrency limit per kind. Finished jobs are kept for the UI. */
export class Jobs {
  list: Job[] = [];
  private running = new Map<Job["kind"], number>();
  private waiting: { job: Job; run: Runner; resolve: (j: Job) => void }[] = [];
  private controllers = new Map<string, AbortController>();

  constructor(private onChange: () => void) {}

  add(kind: Job["kind"], label: string, run: Runner): Promise<Job> {
    const job: Job = { id: newId("j"), kind, label, status: "queued", progress: 0, createdAt: new Date().toISOString() };
    this.list.push(job);
    if (this.list.length > 60) this.list = this.list.filter((j, i) => j.status === "running" || j.status === "queued" || i >= this.list.length - 40);
    const done = new Promise<Job>((resolve) => this.waiting.push({ job, run, resolve }));
    this.pump();
    this.onChange();
    return done;
  }

  cancel(id: string) {
    this.controllers.get(id)?.abort();
  }

  private pump() {
    for (const w of [...this.waiting]) {
      const n = this.running.get(w.job.kind) ?? 0;
      if (n >= LIMITS[w.job.kind]) continue;
      this.waiting.splice(this.waiting.indexOf(w), 1);
      this.running.set(w.job.kind, n + 1);
      void this.exec(w);
    }
  }

  private async exec({ job, run, resolve }: { job: Job; run: Runner; resolve: (j: Job) => void }) {
    const ctrl = new AbortController();
    this.controllers.set(job.id, ctrl);
    job.status = "running";
    this.onChange();
    let last = 0;
    try {
      const result = await run((p, label) => {
        job.progress = p;
        if (label) job.label = label;
        if (Date.now() - last > 250) {
          last = Date.now();
          this.onChange();
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
      this.running.set(job.kind, (this.running.get(job.kind) ?? 1) - 1);
      this.onChange();
      resolve(job);
      this.pump();
    }
  }
}
