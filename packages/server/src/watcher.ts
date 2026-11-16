import { existsSync, type FSWatcher, mkdirSync, watch } from "node:fs";
import { join } from "node:path";
import { ALL_FOLDERS } from "@cezane/engine";

/**
 * Follows the project's Finder folders (Rushes/, Générés/, Captures/, Exports/, recursively):
 * any change triggers `onChange` once things settle (debounce). A slow periodic pass catches
 * what file events miss and re-creates a folder deleted from the Finder.
 */
export class FolderWatcher {
  private watchers = new Map<string, FSWatcher>();
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(
    private dir: string,
    private onChange: () => void,
    private opts: { debounceMs?: number; periodMs?: number } = {},
  ) {}

  start() {
    this.arm();
    this.interval = setInterval(() => {
      this.arm();
      this.onChange();
    }, this.opts.periodMs ?? 20_000);
    this.poke(50); // reconcile what changed while the server was not running
  }

  /** (Re)watches every folder, re-creating the ones that disappeared. */
  private arm() {
    for (const f of ALL_FOLDERS) {
      const p = join(this.dir, f);
      if (this.watchers.has(f) && existsSync(p)) continue;
      this.watchers.get(f)?.close();
      this.watchers.delete(f);
      try {
        mkdirSync(p, { recursive: true });
        const w = watch(p, { recursive: true }, () => this.poke());
        // A folder deleted from the Finder kills its watcher: the next periodic pass re-arms it.
        (w as unknown as { on: (ev: string, cb: () => void) => void }).on("error", () => {
          w.close();
          this.watchers.delete(f);
        });
        this.watchers.set(f, w);
      } catch (e) {
        console.error(`[watch] ${p}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Runs `onChange` after `ms` without new events. */
  poke(ms = this.opts.debounceMs ?? 400) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(), ms);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.interval);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
