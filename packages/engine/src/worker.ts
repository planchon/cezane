import type { Subprocess } from "bun";
import type { WorkerRequest, WorkerResponse } from "@cezane/core";
import { type RenderLog, renderLog } from "./renderlog";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: number) => void; log?: RenderLog };
type Cmd = WorkerRequest["cmd"];
type ArgsOf<C extends Cmd> = Extract<WorkerRequest, { cmd: C }>["args"];

/** Client of the long-lived Remotion render worker (one Chrome kept open between renders). */
export class RenderWorker {
  private proc?: Subprocess<"pipe", "pipe", "pipe">;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  log: (line: string) => void = (l) => console.error(`[remotion] ${l}`);

  private async start() {
    if (this.proc && this.proc.exitCode === null) return this.proc;
    const { workerCommand } = (await import("@cezane/remotion/src/spawn.ts")) as { workerCommand: () => string[] };
    const proc = Bun.spawn(workerCommand(), { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.proc = proc;
    void this.readLines(proc.stdout, (line) => this.onLine(line));
    void this.readLines(proc.stderr, (line) => line.trim() && this.output(line));
    void proc.exited.then((code) => {
      for (const p of this.pending.values()) {
        p.log?.line(`[remotion] le worker s'est arrêté (code ${code})`);
        p.reject(new Error(`render worker exited (${code})`));
      }
      this.pending.clear();
      if (this.proc === proc) this.proc = undefined;
    });
    return proc;
  }

  private async readLines(stream: ReadableStream<Uint8Array>, cb: (line: string) => void) {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of stream) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        cb(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
  }

  /** A line the worker printed: the console, and the log of each render waiting on it. */
  private output(line: string) {
    this.log(line);
    for (const p of this.pending.values()) p.log?.line(`[remotion] ${line}`);
  }

  private onLine(line: string) {
    if (!line.startsWith("{")) return this.output(line);
    let msg: WorkerResponse;
    try {
      msg = JSON.parse(line) as WorkerResponse;
    } catch {
      return this.output(line);
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    if ("progress" in msg) return p.onProgress?.(msg.progress);
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else {
      p.log?.line(`[remotion] ${msg.error}`);
      p.reject(new Error(msg.error));
    }
  }

  /** Requests run one at a time: a single heavy render job at once (16 GB of RAM). */
  request<C extends Cmd>(cmd: C, args: ArgsOf<C>, onProgress?: (p: number) => void): Promise<unknown> {
    const log = renderLog(); // the render this request belongs to, if any
    const run = async () => {
      const proc = await this.start();
      const id = `r${++this.seq}`;
      log?.line(`[remotion] ${cmd}${"start" in args ? ` ${args.start}–${args.end}` : ""}`);
      const done = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject, onProgress, log }));
      proc.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
      await proc.stdin.flush();
      return done;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Lets the worker close its Chrome (end of stdin), then makes sure it is gone. */
  async stop() {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    try {
      proc.stdin.end();
    } catch {}
    await Promise.race([proc.exited, Bun.sleep(6000)]);
    if (proc.exitCode === null) proc.kill();
  }
}
