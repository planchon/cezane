import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** ffmpeg progress lines (`frame=  120 fps=… time=… speed=…`): noise in a failure log. */
const PROGRESS = /^\s*(frame|size)=.*\btime=/;

/**
 * What a render printed: the commands it ran with their stderr (ffmpeg, the cutout tool), the
 * Remotion worker's output, the server's own steps. Keeps the last `cap` characters in memory and
 * writes them to `file` (at most once a second, and on `flush`), so an interrupted render still
 * leaves its log behind.
 */
export class RenderLog {
  private text = "";
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly file?: string,
    readonly cap = 256_000,
  ) {}

  /** Adds lines (a chunk may hold several; `\r` progress updates keep their last state, ffmpeg progress is dropped). */
  line(s: string) {
    const lines = s
      .split("\n")
      .map((l) => l.split("\r").filter((x) => x.trim()).at(-1) ?? "")
      .filter((l) => l.trim() && !PROGRESS.test(l));
    if (!lines.length) return;
    this.text += `${lines.join("\n")}\n`;
    if (this.text.length > this.cap) {
      const cut = this.text.indexOf("\n", this.text.length - this.cap);
      this.text = this.text.slice(cut + 1);
    }
    this.schedule();
  }

  /** The whole kept log. */
  all(): string {
    return this.text;
  }

  /** The last lines, at most `maxChars` characters. */
  tail(maxLines = 40, maxChars = 3000): string {
    return tailOf(this.text, maxLines, maxChars);
  }

  private schedule() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 1000);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, this.text);
    } catch {
      // the log is a diagnostic: never fail a render over it
    }
  }
}

/** The last lines of a text, at most `maxChars` characters. */
export function tailOf(text: string, maxLines = 40, maxChars = 3000): string {
  const lines = text.trimEnd().split("\n").slice(-maxLines).join("\n");
  return lines.length > maxChars ? lines.slice(lines.indexOf("\n", lines.length - maxChars) + 1 || lines.length - maxChars) : lines;
}

const current = new AsyncLocalStorage<RenderLog>();

/** Runs `fn` with `log` as the render log: every command it runs (and the Remotion worker) writes there. */
export function withRenderLog<T>(log: RenderLog, fn: () => Promise<T>): Promise<T> {
  return current.run(log, fn);
}

/** The render log of the running render, if any. */
export function renderLog(): RenderLog | undefined {
  return current.getStore();
}
