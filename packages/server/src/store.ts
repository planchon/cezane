import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  type Analysis,
  type Asset,
  type CanvasDoc,
  type Comment,
  type Montage,
  type Op,
  type Project,
  type Transcript,
  type Version,
  applyOps,
  CanvasDoc as CanvasDocSchema,
  Comment as CommentSchema,
  emptyMontage,
  Montage as MontageSchema,
  newId,
  Project as ProjectSchema,
  Version as VersionSchema,
} from "@cezane/core";
import { ALL_FOLDERS, CACHE_DIR } from "@cezane/engine";
import { legacyFailure } from "./failures";
import { LAYOUT_VERSION, readLayout, writeLayout } from "./layout";
import { type MigrationReport, migrateProject } from "./migrate";

const now = () => new Date().toISOString();

function writeJson(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}
const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

export type Revision = { rev: number; at: string; author: "claude" | "user"; summary: string[]; reason?: string };

const ACTIVE_REEL = ".cezane/active-reel.json";

/**
 * One montage (reel) of the project and its revision history. Every change goes through `edit`,
 * which validates the ops and records a revision (full copy + journal line). The project's first
 * montage keeps its history in `.cezane/history/` (as before reels existed); the others in
 * `.cezane/history/<montageId>/`. Revision numbers are per reel.
 */
export class Reel {
  montage!: Montage;
  revision = 0;

  constructor(
    private store: ProjectStore,
    readonly id: string,
    readonly historyDir: string,
  ) {}

  load(): this {
    mkdirSync(this.store.path(this.historyDir), { recursive: true });
    this.montage = MontageSchema.parse(readJson(this.store.path("montages", `${this.id}.json`), {}));
    this.revision = this.journal().at(-1)?.rev ?? 0;
    return this;
  }

  private file = (...p: string[]) => this.store.path(this.historyDir, ...p);

  save() {
    writeJson(this.store.path("montages", `${this.id}.json`), this.montage);
  }

  journal(): Revision[] {
    const p = this.file("journal.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Revision);
  }

  /** Applies a batch of ops as one revision. Throws OpError without touching anything. */
  edit(ops: Op[], author: Revision["author"], reason?: string): { summary: string[]; revision: number } {
    const { montage, summary } = applyOps(this.montage, ops, { assetIds: new Set(this.store.project.assets.map((a) => a.id)) });
    this.commit(montage, author, summary, reason);
    return { summary, revision: this.revision };
  }

  /** A new revision. The id and the name stay the reel's own (a rename is not a revision). */
  commit(montage: Montage, author: Revision["author"], summary: string[], reason?: string) {
    this.montage = { ...montage, id: this.id, name: this.montage.name };
    this.revision += 1;
    this.save();
    writeJson(this.file(`${this.revision}.json`), this.montage);
    appendFileSync(this.file("journal.jsonl"), `${JSON.stringify({ rev: this.revision, at: now(), author, summary, reason } satisfies Revision)}\n`);
  }

  montageAt(rev: number): Montage | undefined {
    const p = this.file(`${rev}.json`);
    return existsSync(p) ? MontageSchema.parse(JSON.parse(readFileSync(p, "utf8"))) : undefined;
  }

  undo(): boolean {
    const prev = this.montageAt(this.revision - 1);
    if (!prev) return false;
    this.commit(prev, "user", [`undo of revision ${this.revision}`]);
    return true;
  }

  rename(name: string) {
    this.montage = { ...this.montage, name };
    this.save();
  }
}

/**
 * The project on disk. The server is its only writer. A project holds one or more reels
 * (montages); one of them is selected (`activeId`, kept in .cezane/active-reel.json) and the
 * montage-level API (`montage`, `revision`, `edit`, `undo`…) acts on it.
 */
export class ProjectStore {
  project!: Project;
  activeId!: string;
  comments: Comment[] = [];
  versions: Version[] = [];
  private reels = new Map<string, Reel>();
  private memo = new Map<string, unknown>();

  constructor(readonly dir: string) {}

  static init(dir: string, name = basename(dir)): ProjectStore {
    for (const d of ["montages", "canvases", "graphics", ".cezane/history", ".cezane/versions", ".cezane/renders", ".cezane/comments", ...ALL_FOLDERS])
      mkdirSync(join(dir, d), { recursive: true });
    if (!existsSync(join(dir, "cezane.json"))) {
      if (!readLayout(dir)) writeLayout(dir, { version: LAYOUT_VERSION, migratedAt: new Date().toISOString(), moves: {} });
      const m = emptyMontage("Montage");
      const canvas: CanvasDoc = { id: newId("cv"), name: "Canvas", pending: [], updatedAt: now() };
      const p = ProjectSchema.parse({ name, createdAt: now(), montages: [{ id: m.id, name: m.name }], canvases: [{ id: canvas.id, name: canvas.name }] });
      writeJson(join(dir, "cezane.json"), p);
      writeJson(join(dir, "montages", `${m.id}.json`), m);
      writeJson(join(dir, "canvases", `${canvas.id}.json`), canvas);
      writeJson(join(dir, "comments.json"), []);
      writeJson(join(dir, "versions.json"), []);
      writeJson(join(dir, ".cezane/history/0.json"), m);
    }
    return new ProjectStore(dir).load();
  }

  /** Opens an existing project: migrates its folder layout if needed (safe, idempotent), then loads it. */
  static open(dir: string): { store: ProjectStore; migration: MigrationReport } {
    const migration = migrateProject(dir);
    if (migration.status === "failed") console.error(`[migration] ${dir}: ${migration.error} (project left untouched)`);
    else if (migration.status === "migrated") console.log(`[migration] ${dir}: ${migration.moved.length} file(s) moved, ${migration.exported.length} export(s), ${migration.repaired.length} repaired`);
    return { store: new ProjectStore(dir).load(), migration };
  }

  load(): this {
    for (const d of [".cezane/history", ".cezane/versions", ".cezane/renders", ".cezane/comments", ...ALL_FOLDERS]) mkdirSync(join(this.dir, d), { recursive: true });
    this.project = ProjectSchema.parse(readJson(join(this.dir, "cezane.json"), {}));
    const ref = this.project.montages[0];
    if (!ref) throw new Error("project has no montage");
    const saved = readJson<{ id?: string }>(join(this.dir, ACTIVE_REEL), {}).id;
    this.activeId = this.project.montages.some((m) => m.id === saved) ? saved! : ref.id;
    this.reels.clear();
    this.reel();
    this.comments = readJson<unknown[]>(join(this.dir, "comments.json"), []).map((c) => CommentSchema.parse(c));
    this.versions = readJson<unknown[]>(join(this.dir, "versions.json"), []).map((v) => VersionSchema.parse(v));
    // A render interrupted by a restart is not coming back. Failures saved before they were classified get a kind.
    for (const v of this.versions) {
      if (v.status === "rendering") {
        const failure = legacyFailure(v, this.dir, true);
        Object.assign(v, { status: "error", error: failure.message, failure });
      } else if (v.status === "error" && !v.failure) v.failure = legacyFailure(v, this.dir);
    }
    return this;
  }

  path = (...p: string[]) => join(this.dir, ...p);

  saveProject() {
    writeJson(this.path("cezane.json"), this.project);
  }
  saveComments() {
    writeJson(this.path("comments.json"), this.comments);
  }
  saveVersions() {
    writeJson(this.path("versions.json"), this.versions);
  }

  // ───── reels ─────

  /** A reel by montage id (the selected one by default), loaded on first use. */
  reel(id = this.activeId): Reel {
    const open = this.reels.get(id);
    if (open) return open;
    if (!this.project.montages.some((m) => m.id === id)) throw Object.assign(new Error(`unknown reel ${id}`), { status: 404 });
    const own = `.cezane/history/${id}`;
    const history = existsSync(this.path(own)) || id !== this.project.montages[0]?.id ? own : ".cezane/history";
    const r = new Reel(this, id, history).load();
    this.reels.set(id, r);
    return r;
  }

  /** The reel a version or comment belongs to (an unknown montage id falls back to the first reel). */
  reelOf(montageId: string | undefined): string {
    return this.project.montages.some((m) => m.id === montageId) ? montageId! : this.project.montages[0]!.id;
  }

  /** Makes a reel the selected one (remembered across restarts). */
  select(id: string): Reel {
    const r = this.reel(id);
    this.activeId = id;
    writeJson(this.path(ACTIVE_REEL), { id });
    return r;
  }

  /** A new empty reel with the selected reel's format, grade and audio settings. */
  createReel(name: string): Reel {
    const base = this.montage;
    const m = { ...emptyMontage(name, base.settings), audio: structuredClone(base.audio) };
    const history = `.cezane/history/${m.id}`;
    mkdirSync(this.path(history), { recursive: true });
    writeJson(this.path("montages", `${m.id}.json`), m);
    writeJson(this.path(history, "0.json"), m);
    this.project.montages.push({ id: m.id, name });
    this.saveProject();
    return this.reel(m.id);
  }

  renameReel(id: string, name: string): Reel {
    const r = this.reel(id);
    const ref = this.project.montages.find((m) => m.id === id)!;
    ref.name = name;
    r.rename(name);
    this.saveProject();
    return r;
  }

  /** The versions of a reel (the selected one by default). */
  reelVersions(id = this.activeId): Version[] {
    return this.versions.filter((v) => this.reelOf(v.montageId) === id);
  }

  /** The comments shown with a reel: its own, plus the canvas comments (the canvas is project-wide). */
  reelComments(id = this.activeId): Comment[] {
    return this.comments.filter((c) => c.anchor.kind === "canvas" || this.reelOf(c.anchor.montageId) === id);
  }

  /** Id and display number of the next version of a reel: ids stay unique in the project (v1, v2…), numbers count per reel. */
  nextVersion(reelId = this.activeId): { id: string; n: number } {
    const top = this.versions.reduce((m, v) => Math.max(m, Number(/^v(\d+)$/.exec(v.id)?.[1] ?? 0)), 0);
    const n = this.reelVersions(reelId).reduce((m, v) => Math.max(m, v.n), 0) + 1;
    return { id: `v${top + 1}`, n };
  }

  // ───── the selected reel (the montage API every route and tool used before reels) ─────

  get montage(): Montage {
    return this.reel().montage;
  }
  get revision(): number {
    return this.reel().revision;
  }
  journal(): Revision[] {
    return this.reel().journal();
  }
  edit(ops: Op[], author: Revision["author"], reason?: string): { summary: string[]; revision: number } {
    return this.reel().edit(ops, author, reason);
  }
  montageAt(rev: number): Montage | undefined {
    return this.reel().montageAt(rev);
  }
  undo(): boolean {
    return this.reel().undo();
  }

  /** Restores a version's montage as a new revision of its own reel. */
  restoreVersion(id: string): boolean {
    const v = this.versions.find((x) => x.id === id);
    if (!v) return false;
    const m = MontageSchema.parse(JSON.parse(readFileSync(this.path(v.montageFile), "utf8")));
    this.reel(this.reelOf(v.montageId)).commit(m, "user", [`restored ${v.id}`]);
    return true;
  }

  versionMontage(id: string): Montage | undefined {
    const v = this.versions.find((x) => x.id === id);
    return v ? MontageSchema.parse(JSON.parse(readFileSync(this.path(v.montageFile), "utf8"))) : undefined;
  }

  // ───── assets ─────

  asset(id: string): Asset | undefined {
    return this.project.assets.find((a) => a.id === id);
  }
  assetMap(): Map<string, Asset> {
    return new Map(this.project.assets.map((a) => [a.id, a]));
  }
  /** Every current montage of the project (the loaded reels from memory, the others from disk). */
  montages(): Montage[] {
    return this.project.montages.flatMap((ref) => {
      const open = this.reels.get(ref.id);
      if (open) return [open.montage];
      const p = this.path("montages", `${ref.id}.json`);
      if (!existsSync(p)) return [];
      try {
        return [MontageSchema.parse(JSON.parse(readFileSync(p, "utf8")))];
      } catch {
        return [];
      }
    });
  }

  /** assetId → ids of the montages (and canvases) whose current content refers to it. */
  usage(): Map<string, string[]> {
    const docs: { id: string; text: string }[] = this.montages().map((m) => ({ id: m.id, text: JSON.stringify(m) }));
    const cdir = this.path("canvases");
    if (existsSync(cdir))
      for (const f of readdirSync(cdir).filter((x) => x.endsWith(".json"))) docs.push({ id: f.replace(/\.json$/, ""), text: readFileSync(join(cdir, f), "utf8") });
    const out = new Map<string, string[]>();
    for (const a of this.project.assets) {
      const ids = docs.filter((d) => d.text.includes(`"${a.id}"`)).map((d) => d.id);
      if (ids.length) out.set(a.id, ids);
    }
    return out;
  }

  // Assets whose file was deleted from the Finder while nothing used them: kept aside, so the
  // same file put back (Trash → Put Back) gets its old id again.
  private trashPath = () => this.path(".cezane/trash.json");
  trash(): Asset[] {
    return readJson<Asset[]>(this.trashPath(), []);
  }
  moveToTrash(ids: string[]) {
    const gone = this.project.assets.filter((a) => ids.includes(a.id));
    if (!gone.length) return;
    this.project.assets = this.project.assets.filter((a) => !ids.includes(a.id));
    writeJson(this.trashPath(), [...this.trash().filter((t) => !ids.includes(t.id)), ...gone].slice(-500));
    this.saveProject();
  }
  restoreFromTrash(hash: string, file: string): Asset | undefined {
    const t = this.trash();
    const a = t.find((x) => x.hash === hash);
    if (!a) return undefined;
    writeJson(this.trashPath(), t.filter((x) => x !== a));
    const restored = { ...a, file, missing: undefined };
    this.project.assets.push(restored);
    this.saveProject();
    return restored;
  }

  updateAsset(id: string, patch: Partial<Asset>) {
    const a = this.asset(id);
    if (!a) return;
    Object.assign(a, patch, patch.derived ? { derived: { ...a.derived, ...patch.derived } } : {});
    this.saveProject();
  }
  cachePath(a: Asset, file: string | undefined): string | undefined {
    return file ? join(CACHE_DIR, a.hash, file) : undefined;
  }
  private cachedJson<T>(a: Asset | undefined, file: string | undefined): T | undefined {
    const p = a && this.cachePath(a, file);
    if (!p || !existsSync(p)) return undefined;
    if (!this.memo.has(p)) this.memo.set(p, JSON.parse(readFileSync(p, "utf8")));
    return this.memo.get(p) as T;
  }
  transcript = (assetId: string) => {
    const a = this.asset(assetId);
    return this.cachedJson<Transcript>(a, a?.derived.transcript);
  };
  analysis = (assetId: string) => {
    const a = this.asset(assetId);
    return this.cachedJson<Analysis>(a, a?.derived.analysis);
  };
  waveform = (assetId: string) => {
    const a = this.asset(assetId);
    return this.cachedJson<number[]>(a, a?.derived.waveform);
  };

  // ───── canvases ─────

  canvas(id: string): CanvasDoc | undefined {
    const p = this.path("canvases", `${id}.json`);
    return existsSync(p) ? CanvasDocSchema.parse(JSON.parse(readFileSync(p, "utf8"))) : undefined;
  }
  saveCanvas(doc: CanvasDoc) {
    writeJson(this.path("canvases", `${doc.id}.json`), { ...doc, updatedAt: now() });
    if (!this.project.canvases.some((c) => c.id === doc.id)) {
      this.project.canvases.push({ id: doc.id, name: doc.name });
      this.saveProject();
    }
  }
}

export { now };
