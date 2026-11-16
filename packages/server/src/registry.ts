import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CEZANE_HOME, nfc, slugify, uniqueName } from "@cezane/engine";
import { writeAtomic } from "./layout";
import { ProjectStore } from "./store";

export type RegistryEntry = {
  id: string; // stable, readable: "dax", "mon-reel-2"
  path: string; // absolute folder, NFC
  location: "projets" | "external" | "demo";
  addedAt: string;
  openedAt?: string;
};
type RegistryDoc = { version: 1; projects: RegistryEntry[]; hidden: string[] };

const now = () => new Date().toISOString();
/** Absolute, symlinks resolved when the folder exists (/tmp = /private/tmp), NFC. */
const norm = (p: string) => {
  const abs = resolve(p);
  try {
    return nfc(realpathSync(abs));
  } catch {
    return nfc(abs);
  }
};
/** Ids that would collide with the routes under /api/projects/. */
const RESERVED = new Set(["events", "open"]);
const isProject = (dir: string) => existsSync(join(dir, "cezane.json"));

/**
 * Every project the server knows. Projects live in ~/Cezane/Projets/<nom>/ (found by scanning
 * that folder); folders opened from elsewhere and the repo demos are remembered in
 * ~/Cezane/projets.json, with the stable id of each project. Forgetting a project only removes
 * it from the list (its folder is never touched); opening it again brings it back.
 */
export class ProjectRegistry {
  readonly home: string;
  readonly projetsDir: string;
  readonly file: string;
  private doc: RegistryDoc;
  private demoDirs: string[];

  constructor(opts: { home?: string; demoDirs?: string[] } = {}) {
    this.home = opts.home ?? CEZANE_HOME;
    this.projetsDir = join(this.home, "Projets");
    this.file = join(this.home, "projets.json");
    this.demoDirs = (opts.demoDirs ?? []).map(norm);
    this.doc = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as RegistryDoc) : { version: 1, projects: [], hidden: [] };
    this.doc.hidden ??= [];
    this.refresh();
  }

  private save() {
    mkdirSync(this.home, { recursive: true });
    writeAtomic(this.file, JSON.stringify(this.doc, null, 2));
  }

  private locationOf(path: string): RegistryEntry["location"] {
    if (path.startsWith(norm(this.projetsDir) + sep)) return "projets";
    if (this.demoDirs.includes(path)) return "demo";
    return "external";
  }

  private newId(path: string): string {
    const base = slugify(path.split(sep).pop() ?? "projet", 32) || "projet";
    const used = new Set([...this.doc.projects.map((p) => p.id), ...RESERVED]);
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  /** Finds new folders in ~/Cezane/Projets, adds the demos, drops demos whose checkout is gone. */
  refresh() {
    const before = JSON.stringify(this.doc);
    this.doc.projects = this.doc.projects.filter((p) => p.location !== "demo" || existsSync(p.path));
    const found: string[] = [];
    if (existsSync(this.projetsDir))
      for (const e of readdirSync(this.projetsDir, { withFileTypes: true })) if (e.isDirectory() && isProject(join(this.projetsDir, e.name))) found.push(norm(join(this.projetsDir, e.name)));
    for (const d of this.demoDirs) if (isProject(d)) found.push(d);
    for (const path of found) if (!this.doc.hidden.includes(path) && !this.byPath(path)) this.doc.projects.push({ id: this.newId(path), path, location: this.locationOf(path), addedAt: now() });
    if (JSON.stringify(this.doc) !== before) this.save();
  }

  /** Most recently opened first, then in the order they were added. */
  list(): RegistryEntry[] {
    return [...this.doc.projects].sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""));
  }

  get(id: string): RegistryEntry | undefined {
    return this.doc.projects.find((p) => p.id === id);
  }

  byPath(path: string): RegistryEntry | undefined {
    const p = norm(path);
    return this.doc.projects.find((e) => e.path === p);
  }

  /** Remembers an existing project folder (or returns its entry). `init` creates cezane.json first. */
  add(path: string, opts: { init?: boolean; name?: string } = {}): RegistryEntry {
    const dir = norm(path);
    if (!isProject(dir)) {
      if (!opts.init) throw new Error(`not a Cezane project (no cezane.json): ${dir}`);
      ProjectStore.init(dir, opts.name);
    }
    this.doc.hidden = this.doc.hidden.filter((h) => h !== dir);
    let e = this.byPath(dir);
    if (!e) {
      e = { id: this.newId(dir), path: dir, location: this.locationOf(dir), addedAt: now() };
      this.doc.projects.push(e);
    }
    this.save();
    return e;
  }

  /** A new project in ~/Cezane/Projets/<name>/ ("<name> 2" when the folder exists). */
  create(name: string): RegistryEntry {
    mkdirSync(this.projetsDir, { recursive: true });
    const folder = uniqueName(this.projetsDir, name.trim() || "Nouveau projet");
    return this.add(join(this.projetsDir, folder), { init: true, name: name.trim() || folder });
  }

  /** Removes a project from the list; its folder stays as it is. */
  forget(id: string): boolean {
    const e = this.get(id);
    if (!e) return false;
    this.doc.projects = this.doc.projects.filter((p) => p !== e);
    if (!this.doc.hidden.includes(e.path)) this.doc.hidden.push(e.path);
    this.save();
    return true;
  }

  touch(id: string) {
    const e = this.get(id);
    if (!e) return;
    e.openedAt = now();
    this.save();
  }
}
