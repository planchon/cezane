import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { Provenance } from "@cezane/core";
import { ALL_FOLDERS } from "@cezane/engine";
import { exportRender, fileNameFor, folderFor, LAYOUT_VERSION, readLayout, reelSlug, writeAtomic, writeLayout } from "./layout";

type RawAsset = { id: string; name?: string; file: string; provenance: unknown };
type RawProject = { name?: string; assets?: RawAsset[]; montages?: { id: string; name: string }[] } & Record<string, unknown>;
type RawVersion = { id: string; n: number; montageId: string; status: string; file?: string; exportFile?: string } & Record<string, unknown>;
type Move = { from: string; to: string; assets: string[] };
type Journal = { startedAt: string; moves: Move[]; exports: string[] };

export type MigrationReport = {
  dir: string;
  status: "migrated" | "up-to-date" | "failed";
  moved: Move[];
  repaired: string[]; // assets whose stale media/ path was fixed from the layout record
  exported: string[]; // renders linked into Exports/
  orphans: string[]; // files left in media/ that no asset uses (never deleted)
  missing: string[]; // assets whose media/ file does not exist (left as they are)
  recovered?: "rolled-back" | "completed"; // an interrupted migration found on open
  error?: string;
};

const JOURNAL = ".cezane/migration.json";
const readJson = <T>(p: string): T | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : undefined);

/**
 * Migrates a project from media/<hash>.<ext> to the Finder layout (Rushes/, Générés/,
 * Captures/, Exports/). Idempotent: run it on every open. Safe: the plan is journaled before the
 * first move; any failure moves everything back and leaves the documents untouched; a migration
 * interrupted by a crash is rolled back (or completed if the documents were already rewritten)
 * on the next run. Unreferenced files in media/ are left where they are.
 */
export function migrateProject(dir: string, opts: { failAfterMoves?: number } = {}): MigrationReport {
  const report: MigrationReport = { dir, status: "up-to-date", moved: [], repaired: [], exported: [], orphans: [], missing: [] };
  const projectPath = join(dir, "cezane.json");
  const versionsPath = join(dir, "versions.json");
  const journalPath = join(dir, JOURNAL);
  if (!existsSync(projectPath)) return report;

  // ── an interrupted migration ──
  const pending = readJson<Journal>(journalPath);
  if (pending) {
    const project = readJson<RawProject>(projectPath)!;
    const byId = new Map((project.assets ?? []).map((a) => [a.id, a]));
    const committed = pending.moves.length > 0 && pending.moves.every((m) => m.assets.every((id) => byId.get(id)?.file === m.to));
    if (committed) {
      const layout = readLayout(dir) ?? { version: 1, moves: {} };
      writeLayout(dir, { version: LAYOUT_VERSION, migratedAt: new Date().toISOString(), moves: { ...layout.moves, ...Object.fromEntries(pending.moves.map((m) => [m.from, m.to])) } });
      report.recovered = "completed";
    } else {
      rollback(dir, pending.moves, pending.exports);
      report.recovered = "rolled-back";
    }
    unlinkSync(journalPath);
  }

  const projectText = readFileSync(projectPath, "utf8");
  const project = JSON.parse(projectText) as RawProject;
  const versionsText = existsSync(versionsPath) ? readFileSync(versionsPath, "utf8") : undefined;
  const versions = versionsText ? (JSON.parse(versionsText) as RawVersion[]) : [];
  const layout = readLayout(dir);
  const firstRun = !layout || layout.version < LAYOUT_VERSION;
  const knownMoves = layout?.moves ?? {};

  // ── plan ──
  const reserved = new Map<string, Set<string>>(); // folder → names promised in this plan (lowercase)
  const plan = new Map<string, Move>(); // from → move (two assets may share one file)
  const repairs: { asset: RawAsset; to: string }[] = [];
  for (const a of project.assets ?? []) {
    if (!a.file?.startsWith("media/")) continue;
    const known = knownMoves[a.file];
    if (!existsSync(join(dir, a.file))) {
      // A writer that still had the old paths in memory saved them back: point them at the new files.
      if (known && existsSync(join(dir, known))) repairs.push({ asset: a, to: known });
      else report.missing.push(a.id);
      continue;
    }
    const existing = plan.get(a.file);
    if (existing) {
      existing.assets.push(a.id);
      continue;
    }
    const parsed = Provenance.safeParse(a.provenance);
    const provenance: Provenance = parsed.success ? parsed.data : { type: "import", path: a.file };
    const folder = folderFor(provenance);
    const res = reserved.get(folder) ?? new Set<string>();
    reserved.set(folder, res);
    const name = fileNameFor({ name: a.name, provenance }, extname(a.file) || ".bin", join(dir, folder), res);
    res.add(name.toLowerCase());
    plan.set(a.file, { from: a.file, to: `${folder}/${name}`, assets: [a.id] });
  }
  const moves = [...plan.values()];
  const montageName = new Map((project.montages ?? []).map((m) => [m.id, m.name]));
  const toExport = firstRun ? versions.filter((v) => v.status === "ready" && v.file && !v.exportFile && existsSync(join(dir, v.file))) : [];

  if (!moves.length && !repairs.length && !toExport.length) {
    if (firstRun) writeLayout(dir, { version: LAYOUT_VERSION, migratedAt: new Date().toISOString(), moves: knownMoves });
    report.orphans = orphansOf(dir, project);
    if (report.recovered) report.status = "migrated";
    for (const f of ALL_FOLDERS) mkdirSync(join(dir, f), { recursive: true });
    return report;
  }

  // ── execute ──
  const created: string[] = [];
  for (const f of ALL_FOLDERS)
    if (!existsSync(join(dir, f))) {
      mkdirSync(join(dir, f), { recursive: true });
      created.push(f);
    }
  const journal: Journal = { startedAt: new Date().toISOString(), moves, exports: [] };
  mkdirSync(join(dir, ".cezane/backup"), { recursive: true });
  writeAtomic(journalPath, JSON.stringify(journal, null, 2));
  const done: Move[] = [];
  try {
    // Backups of the documents as they were (never overwritten: the first one is the original).
    const backup = join(dir, ".cezane/backup/cezane.layout-v1.json");
    if (!existsSync(backup)) writeAtomic(backup, projectText);
    if (versionsText && !existsSync(join(dir, ".cezane/backup/versions.layout-v1.json"))) writeAtomic(join(dir, ".cezane/backup/versions.layout-v1.json"), versionsText);
    for (const m of moves) {
      if (opts.failAfterMoves !== undefined && done.length >= opts.failAfterMoves) throw new Error("simulated failure");
      if (existsSync(join(dir, m.to))) throw new Error(`${m.to} already exists`);
      renameSync(join(dir, m.from), join(dir, m.to));
      done.push(m);
    }
    for (const v of toExport) {
      const rel = exportRender(dir, v.file!, reelSlug(project.name ?? "reel", montageName.get(v.montageId)), v.n);
      journal.exports.push(rel);
      writeAtomic(journalPath, JSON.stringify(journal, null, 2));
      v.exportFile = rel;
      report.exported.push(rel);
    }
    const target = new Map(moves.flatMap((m) => m.assets.map((id) => [id, m.to] as const)));
    for (const r of repairs) target.set(r.asset.id, r.to);
    for (const a of project.assets ?? []) {
      const to = target.get(a.id);
      if (to) a.file = to;
    }
    if (toExport.length) writeAtomic(versionsPath, JSON.stringify(versions, null, 2));
    writeAtomic(projectPath, JSON.stringify(project, null, 2));
  } catch (e) {
    rollback(dir, done, journal.exports);
    if (versionsText !== undefined) writeAtomic(versionsPath, versionsText);
    writeAtomic(projectPath, projectText);
    for (const f of created.reverse()) {
      try {
        rmdirSync(join(dir, f));
      } catch {}
    }
    unlinkSync(journalPath);
    return { ...report, status: "failed", exported: [], error: e instanceof Error ? e.message : String(e) };
  }
  writeLayout(dir, { version: LAYOUT_VERSION, migratedAt: new Date().toISOString(), moves: { ...knownMoves, ...Object.fromEntries(moves.map((m) => [m.from, m.to])) } });
  unlinkSync(journalPath);
  report.moved = moves;
  report.repaired = repairs.map((r) => r.asset.id);
  report.orphans = orphansOf(dir, project);
  if (!report.orphans.length && existsSync(join(dir, "media"))) {
    try {
      rmdirSync(join(dir, "media")); // only when empty (a .DS_Store keeps it, harmless)
    } catch {}
  }
  report.status = "migrated";
  return report;
}

function rollback(dir: string, moves: Move[], exports: string[]) {
  for (const m of [...moves].reverse()) {
    const to = join(dir, m.to);
    const from = join(dir, m.from);
    if (existsSync(to) && !existsSync(from)) {
      mkdirSync(join(dir, "media"), { recursive: true });
      renameSync(to, from);
    }
  }
  for (const rel of exports) {
    try {
      unlinkSync(join(dir, rel));
    } catch {}
  }
}

function orphansOf(dir: string, project: RawProject): string[] {
  const media = join(dir, "media");
  if (!existsSync(media)) return [];
  const used = new Set((project.assets ?? []).map((a) => a.file));
  return readdirSync(media)
    .filter((f) => !f.startsWith("."))
    .map((f) => `media/${f}`)
    .filter((f) => !used.has(f));
}
