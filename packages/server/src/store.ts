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

/**
 * The project on disk. The server is its only writer: every montage change goes through
 * `edit`, which validates the ops and records a revision (full copy + journal line).
 */
export class ProjectStore {
  project!: Project;
  montage!: Montage;
  revision = 0;
  comments: Comment[] = [];
  versions: Version[] = [];
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
    this.montage = MontageSchema.parse(readJson(join(this.dir, "montages", `${ref.id}.json`), {}));
    this.comments = readJson<unknown[]>(join(this.dir, "comments.json"), []).map((c) => CommentSchema.parse(c));
    this.versions = readJson<unknown[]>(join(this.dir, "versions.json"), []).map((v) => VersionSchema.parse(v));
    const journal = this.journal();
    this.revision = journal.at(-1)?.rev ?? 0;
    // A render interrupted by a restart is not coming back.
    for (const v of this.versions) if (v.status === "rendering") Object.assign(v, { status: "error", error: "interrupted" });
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
  private saveMontage() {
    writeJson(this.path("montages", `${this.montage.id}.json`), this.montage);
  }

  journal(): Revision[] {
    const p = this.path(".cezane/history/journal.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Revision);
  }

  /** Applies a batch of ops as one revision. Throws OpError without touching anything. */
  edit(ops: Op[], author: Revision["author"], reason?: string): { summary: string[]; revision: number } {
    const { montage, summary } = applyOps(this.montage, ops, { assetIds: new Set(this.project.assets.map((a) => a.id)) });
    this.commit(montage, author, summary, reason);
    return { summary, revision: this.revision };
  }

  private commit(montage: Montage, author: Revision["author"], summary: string[], reason?: string) {
    this.montage = montage;
    this.revision += 1;
    this.saveMontage();
    writeJson(this.path(".cezane/history", `${this.revision}.json`), montage);
    appendFileSync(this.path(".cezane/history/journal.jsonl"), `${JSON.stringify({ rev: this.revision, at: now(), author, summary, reason } satisfies Revision)}\n`);
  }

  montageAt(rev: number): Montage | undefined {
    const p = this.path(".cezane/history", `${rev}.json`);
    return existsSync(p) ? MontageSchema.parse(JSON.parse(readFileSync(p, "utf8"))) : undefined;
  }

  undo(): boolean {
    const prev = this.montageAt(this.revision - 1);
    if (!prev) return false;
    this.commit(prev, "user", [`undo of revision ${this.revision}`]);
    return true;
  }

  restoreVersion(id: string): boolean {
    const v = this.versions.find((x) => x.id === id);
    if (!v) return false;
    const m = MontageSchema.parse(JSON.parse(readFileSync(this.path(v.montageFile), "utf8")));
    this.commit(m, "user", [`restored ${v.id}`]);
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
  /** Every current montage of the project (the loaded one from memory, the others from disk). */
  montages(): Montage[] {
    return this.project.montages.flatMap((ref) => {
      if (ref.id === this.montage.id) return [this.montage];
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
