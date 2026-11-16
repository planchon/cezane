import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Op } from "@cezane/core";
import { providers } from "@cezane/engine";
import { png, tempDir, until } from "../test/helpers";
import type { Cezane } from "./app";
import { Hub } from "./hub";
import { projectFiles } from "./library";

const t = tempDir("cezane-watch-");
const src = join(t.dir, "sources");
let hub: Hub;
let app: Cezane;
const byFile = (rel: string) => app.store.project.assets.find((a) => a.file === rel);

beforeAll(async () => {
  mkdirSync(src, { recursive: true });
  for (const c of ["red", "blue", "green", "yellow", "purple", "orange"]) await png(join(src, `${c}.png`), c);
  hub = new Hub({ port: 1, home: join(t.dir, "Cezane"), demos: false });
  app = hub.setDefault(join(t.dir, "Projet"));
});
afterAll(async () => {
  await hub.stop();
  t.cleanup();
});

describe("folder watcher", () => {
  test("a file added in the Finder becomes an asset and is ingested where it is", async () => {
    copyFileSync(join(src, "red.png"), app.store.path("Rushes/rouge.png"));
    const a = await until(() => byFile("Rushes/rouge.png"), 10_000, "asset from Rushes/rouge.png");
    expect(a.provenance).toEqual({ type: "import", path: app.store.path("Rushes/rouge.png") });
    expect(a.name).toBe("rouge");
    await until(() => app.store.asset(a.id)?.status === "ready", 15_000, "ingest");
    expect(app.store.asset(a.id)!.derived.poster).toBe("poster.jpg");
  }, 30_000);

  test("rename / move keeps the asset (same id), the name follows", async () => {
    const id = byFile("Rushes/rouge.png")!.id;
    mkdirSync(app.store.path("Rushes/Jour 1"), { recursive: true });
    renameSync(app.store.path("Rushes/rouge.png"), app.store.path("Rushes/Jour 1/vermillon.png"));
    await until(() => app.store.asset(id)?.file === "Rushes/Jour 1/vermillon.png", 10_000, "rename");
    expect(app.store.asset(id)!.name).toBe("vermillon");
    expect(app.store.asset(id)!.missing).toBeUndefined();
    expect(app.store.project.assets).toHaveLength(1);
  }, 20_000);

  test("a deleted file used by a montage is marked missing, and comes back", async () => {
    const a = byFile("Rushes/Jour 1/vermillon.png")!;
    app.store.edit([{ op: "add_clip", track: "t_main", clip: { type: "media", assetId: a.id, start: 0, duration: 30 } } as Op], "user");
    unlinkSync(app.store.path(a.file));
    await until(() => app.store.asset(a.id)?.missing, 10_000, "missing flag");
    expect(projectFiles(app).missing).toEqual([{ assetId: a.id, name: "vermillon", path: a.file, usedIn: [app.store.montage.id] }]);
    copyFileSync(join(src, "red.png"), app.store.path(a.file));
    await until(() => !app.store.asset(a.id)?.missing, 10_000, "missing cleared");
  }, 20_000);

  test("a deleted unused file drops its asset; putting it back restores the same id", async () => {
    copyFileSync(join(src, "blue.png"), app.store.path("Générés/bleu.png"));
    const a = await until(() => byFile("Générés/bleu.png"), 10_000, "asset bleu");
    await until(() => app.store.asset(a.id)?.status === "ready", 15_000, "ingest bleu");
    unlinkSync(app.store.path("Générés/bleu.png"));
    await until(() => !app.store.asset(a.id), 10_000, "asset removed");
    expect(app.store.trash().map((x) => x.id)).toContain(a.id);
    copyFileSync(join(src, "blue.png"), app.store.path("Générés/bleu.png"));
    await until(() => app.store.asset(a.id), 10_000, "asset restored");
    expect(app.store.asset(a.id)!.file).toBe("Générés/bleu.png");
  }, 30_000);

  test("files the server writes itself are not imported twice; collisions get ' 2'", async () => {
    const [v1] = await app.importFiles([join(src, "green.png")], undefined, { name: "vert" });
    expect(v1!.file).toBe("Rushes/green.png");
    const other = join(t.dir, "ailleurs");
    mkdirSync(other, { recursive: true });
    await png(join(other, "green.png"), "yellow");
    const [v2] = await app.importFiles([join(other, "green.png")]);
    expect(v2!.file).toBe("Rushes/green 2.png");
    await Bun.sleep(2500); // let the watcher see both files
    expect(app.store.project.assets.filter((a) => a.file.startsWith("Rushes/green"))).toHaveLength(2);
  }, 20_000);

  test("a generation lands straight in Générés/ under a readable name", async () => {
    // A provider that "generates" an orange square.
    providers.push({
      id: "test",
      models: async () => [{ provider: "test", id: "square", label: "Test", kind: "image", inputs: "none", costEur: 0, available: true }],
      run: async (req) => ({ file: await png(join(req.workDir, "out.png"), "orange"), costEur: 0, model: "square", provider: "test" }),
    });
    const job = await app.generate({ provider: "test", model: "square", kind: "image", prompt: "Un fond de studio orange, lumière douce" });
    expect(job.status).toBe("done");
    const a = app.store.asset(job.result!.assetId!)!;
    expect(a.file).toBe("Générés/fond-studio-orange-01.png");
    expect(a.provenance).toMatchObject({ type: "generated", provider: "test", prompt: "Un fond de studio orange, lumière douce" });
    expect(readdirSync(app.store.path(".cezane/generate"))).toEqual([]); // no work dir left
    const again = await app.generate({ provider: "test", model: "square", kind: "image", prompt: "Un fond de studio orange" });
    expect(again.status).toBe("done"); // same pixels: the existing asset
    await Bun.sleep(2000);
    expect(app.store.project.assets.filter((x) => x.file.startsWith("Générés/fond-studio"))).toHaveLength(1);
    const f = projectFiles(app).folders[1]!.files.find((x) => x.assetId === a.id)!;
    expect(f.generated).toMatchObject({ prompt: "Un fond de studio orange, lumière douce", provider: "test", model: "square", references: [] });
    expect(f.thumbUrl).toBe(`/files/cache/${a.hash}/poster.jpg`);
  }, 30_000);

  test("captures dropped by hand, and duplicates", async () => {
    copyFileSync(join(src, "purple.png"), app.store.path("Captures/ecran.png"));
    const c = await until(() => byFile("Captures/ecran.png"), 10_000, "capture asset");
    expect(c.provenance).toEqual({ type: "capture", source: "finder", target: "ecran.png" });
    copyFileSync(join(src, "red.png"), app.store.path("Rushes/copie de rouge.png"));
    const dup = await until(() => projectFiles(app).folders[0]!.files.find((f) => f.name === "copie de rouge.png" && f.duplicateOf), 10_000, "duplicate");
    expect(dup.duplicateOf).toBe(byFile("Rushes/Jour 1/vermillon.png")!.id);
    expect(byFile("Rushes/copie de rouge.png")).toBeUndefined();
  }, 20_000);
});
