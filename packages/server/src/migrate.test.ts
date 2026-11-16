import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyMontage } from "@cezane/core";
import { tempDir } from "../test/helpers";
import { readLayout } from "./layout";
import { migrateProject } from "./migrate";
import { ProjectStore } from "./store";

const t = tempDir("cezane-migrate-");
afterAll(t.cleanup);

/** A project as v0.1 wrote it: every media file as media/<hash>.<ext>. */
function v1Project(name: string) {
  const dir = join(t.dir, name);
  for (const d of ["media", "montages", "canvases", ".cezane/renders", ".cezane/history"]) mkdirSync(join(dir, d), { recursive: true });
  const m = emptyMontage("Montage");
  const asset = (id: string, file: string, provenance: unknown, assetName: string) => {
    writeFileSync(join(dir, file), `content of ${id}`);
    return { id, kind: "image", name: assetName, hash: `h${id}`, file, provenance, derived: {}, status: "ready", tags: [], createdAt: "2026-11-01T00:00:00Z" };
  };
  const assets = [
    asset("a_rush", "media/1111aaaa2222bbbb3333.mov", { type: "import", path: "/Users/x/Movies/Plage été.MOV" }, "Plage été"),
    asset("a_rush2", "media/4444aaaa2222bbbb3333.mov", { type: "import", path: "/Users/x/Other/Plage été.mov" }, "Plage été"),
    asset("a_up", "media/5555aaaa2222bbbb3333.mov", { type: "import", path: "/p/.cezane/uploads/u_ab12cd-interview.mov" }, "u_ab12cd-interview"),
    asset("a_gen", "media/6666aaaa2222bbbb3333.png", { type: "generated", provider: "codex", model: "imagegen", prompt: "Un fond de studio blanc", inputs: [], settings: {} }, "Un fond de studio blanc"),
    asset("a_gen2", "media/7777aaaa2222bbbb3333.png", { type: "generated", provider: "codex", model: "imagegen", prompt: "Un fond de studio blanc, variante", inputs: ["a_gen"], settings: {} }, "variante"),
    asset("a_cap", "media/8888aaaa2222bbbb3333.png", { type: "capture", source: "web", target: "https://rewind.codes" }, "8888aaaa2222bbbb3333"),
    asset("a_cap2", "media/9999aaaa2222bbbb3333.webm", { type: "capture", source: "ios", target: "Dax" }, "dax-today"),
  ];
  // Two assets on the same file must stay on the same file.
  assets.push({ ...assets[5]!, id: "a_cap_twin", name: "capture-c_676rrb" });
  writeFileSync(join(dir, "media/orphan.bin"), "nobody uses me");
  writeFileSync(join(dir, ".cezane/renders/v1.mp4"), "render v1");
  writeFileSync(join(dir, ".cezane/renders/v1.jpg"), "poster v1");
  const project = { name, createdAt: "2026-11-01T00:00:00Z", assets, montages: [{ id: m.id, name: m.name }], canvases: [], settings: { claudeModel: "sonnet", budgetEur: 5, spentEur: 0 } };
  writeFileSync(join(dir, "cezane.json"), JSON.stringify(project, null, 2));
  writeFileSync(join(dir, "montages", `${m.id}.json`), JSON.stringify(m));
  const v = (n: number, status: string) => ({ id: `v${n}`, n, montageId: m.id, revision: 0, author: "user", summary: "", status, montageFile: "x", durationFrames: 30, fps: 30, file: `.cezane/renders/v${n}.mp4`, poster: `.cezane/renders/v${n}.jpg`, createdAt: "2026-11-01T00:00:00Z" });
  writeFileSync(join(dir, "versions.json"), JSON.stringify([v(1, "ready"), v(2, "error")], null, 2));
  writeFileSync(join(dir, "comments.json"), "[]");
  return dir;
}

const read = (dir: string) => JSON.parse(readFileSync(join(dir, "cezane.json"), "utf8")) as { assets: { id: string; file: string }[] };
const fileOf = (dir: string, id: string) => read(dir).assets.find((a) => a.id === id)!.file;
const listing = (dir: string) => readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.startsWith(".cezane")).sort();

describe("layout migration", () => {
  test("moves media into readable Finder folders and updates every reference", () => {
    const dir = v1Project("Dax — explication");
    const r = migrateProject(dir);
    expect(r.status).toBe("migrated");
    expect(fileOf(dir, "a_rush")).toBe("Rushes/Plage été.MOV");
    expect(fileOf(dir, "a_rush2")).toBe("Rushes/Plage été 2.mov");
    expect(fileOf(dir, "a_up")).toBe("Rushes/interview.mov");
    expect(fileOf(dir, "a_gen")).toBe("Générés/fond-studio-blanc-01.png");
    expect(fileOf(dir, "a_gen2")).toBe("Générés/fond-studio-blanc-02.png");
    expect(fileOf(dir, "a_cap")).toBe("Captures/rewind-codes-01.png");
    expect(fileOf(dir, "a_cap2")).toBe("Captures/dax-today.webm");
    expect(fileOf(dir, "a_cap_twin")).toBe("Captures/rewind-codes-01.png");
    for (const a of read(dir).assets) expect(readFileSync(join(dir, a.file), "utf8")).toStartWith("content of");
    // Exports: the ready render, hard-linked, named after the project (the montage is unnamed).
    const versions = JSON.parse(readFileSync(join(dir, "versions.json"), "utf8"));
    expect(versions[0].exportFile).toBe("Exports/dax-explication-v1.mp4");
    expect(versions[1].exportFile).toBeUndefined();
    expect(statSync(join(dir, "Exports/dax-explication-v1.mp4")).ino).toBe(statSync(join(dir, ".cezane/renders/v1.mp4")).ino);
    // Nothing lost: the orphan stays in media/, the old documents are backed up.
    expect(r.orphans).toEqual(["media/orphan.bin"]);
    expect(existsSync(join(dir, ".cezane/backup/cezane.layout-v1.json"))).toBe(true);
    expect(readLayout(dir)?.moves["media/6666aaaa2222bbbb3333.png"]).toBe("Générés/fond-studio-blanc-01.png");
    expect(existsSync(join(dir, ".cezane/migration.json"))).toBe(false);
    // The project loads with the schema.
    const s = ProjectStore.open(dir).store;
    expect(s.asset("a_gen")!.file).toBe("Générés/fond-studio-blanc-01.png");
  });

  test("is idempotent", () => {
    const dir = v1Project("Idem");
    migrateProject(dir);
    const before = { project: readFileSync(join(dir, "cezane.json"), "utf8"), versions: readFileSync(join(dir, "versions.json"), "utf8"), files: listing(dir) };
    rmExport(dir); // an export deleted from the Finder is not re-created
    const r = migrateProject(dir);
    expect(r.status).toBe("up-to-date");
    expect(r.moved).toEqual([]);
    expect(readFileSync(join(dir, "cezane.json"), "utf8")).toBe(before.project);
    expect(readFileSync(join(dir, "versions.json"), "utf8")).toBe(before.versions);
    expect(listing(dir)).toEqual(before.files.filter((f) => !f.startsWith("Exports/")));
  });

  test("a failure moves everything back and leaves the project untouched", () => {
    const dir = v1Project("Echec");
    const before = { project: readFileSync(join(dir, "cezane.json"), "utf8"), versions: readFileSync(join(dir, "versions.json"), "utf8"), files: listing(dir) };
    const r = migrateProject(dir, { failAfterMoves: 3 });
    expect(r.status).toBe("failed");
    expect(readFileSync(join(dir, "cezane.json"), "utf8")).toBe(before.project);
    expect(readFileSync(join(dir, "versions.json"), "utf8")).toBe(before.versions);
    expect(listing(dir)).toEqual(before.files);
    expect(existsSync(join(dir, ".cezane/migration.json"))).toBe(false);
    expect(migrateProject(dir).status).toBe("migrated"); // and it works next time
  });

  test("an interrupted migration is rolled back, then redone", () => {
    const dir = v1Project("Crash");
    const before = readFileSync(join(dir, "cezane.json"), "utf8");
    // Simulate a crash after the first move: journal written, one file moved, documents not rewritten.
    mkdirSync(join(dir, "Rushes"), { recursive: true });
    renameSync(join(dir, "media/1111aaaa2222bbbb3333.mov"), join(dir, "Rushes/Plage été.MOV"));
    writeFileSync(join(dir, ".cezane/migration.json"), JSON.stringify({ startedAt: "x", moves: [{ from: "media/1111aaaa2222bbbb3333.mov", to: "Rushes/Plage été.MOV", assets: ["a_rush"] }], exports: [] }));
    const r = migrateProject(dir);
    expect(r.recovered).toBe("rolled-back");
    expect(r.status).toBe("migrated");
    expect(fileOf(dir, "a_rush")).toBe("Rushes/Plage été.MOV");
    expect(readFileSync(join(dir, ".cezane/backup/cezane.layout-v1.json"), "utf8")).toBe(before);
  });

  test("stale media/ paths written back by an old server are repaired from the layout record", () => {
    const dir = v1Project("Stale");
    const old = readFileSync(join(dir, "cezane.json"), "utf8");
    migrateProject(dir);
    writeFileSync(join(dir, "cezane.json"), old); // an old process saved its in-memory project
    const r = migrateProject(dir);
    expect(r.repaired.sort()).toEqual(["a_cap", "a_cap2", "a_cap_twin", "a_gen", "a_gen2", "a_rush", "a_rush2", "a_up"]);
    expect(fileOf(dir, "a_rush")).toBe("Rushes/Plage été.MOV");
    expect(migrateProject(dir).status).toBe("up-to-date");
  });

  test("a new project starts in the new layout", () => {
    const dir = join(t.dir, "Neuf");
    ProjectStore.init(dir, "Neuf");
    expect(readLayout(dir)?.version).toBe(2);
    expect(existsSync(join(dir, "media"))).toBe(false);
    expect(migrateProject(dir).status).toBe("up-to-date");
  });
});

function rmExport(dir: string) {
  for (const f of readdirSync(join(dir, "Exports"))) Bun.spawnSync(["rm", join(dir, "Exports", f)]);
}
