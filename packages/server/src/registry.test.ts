import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../test/helpers";
import { ProjectRegistry } from "./registry";
import { ProjectStore } from "./store";

const t = tempDir("cezane-registry-");
afterAll(t.cleanup);
const home = join(t.dir, "Cezane");

describe("project registry", () => {
  const demo = join(t.dir, "repo/demo/dax");
  ProjectStore.init(demo, "Dax");

  test("creates projects in ~/Cezane/Projets with unique folders and ids", () => {
    const r = new ProjectRegistry({ home, demoDirs: [demo] });
    const a = r.create("Mon reel");
    const b = r.create("Mon reel");
    expect(a.path).toBe(join(home, "Projets", "Mon reel"));
    expect(b.path).toBe(join(home, "Projets", "Mon reel 2"));
    expect([a.id, b.id]).toEqual(["mon-reel", "mon-reel-2"]);
    expect(a.location).toBe("projets");
    expect(existsSync(join(b.path, "Rushes"))).toBe(true);
    expect(existsSync(join(b.path, "Générés"))).toBe(true);
    expect(JSON.parse(readFileSync(join(a.path, "cezane.json"), "utf8")).name).toBe("Mon reel");
  });

  test("seeds the demos, remembers external folders, persists ids", () => {
    const ext = join(t.dir, "ailleurs/Client X");
    const r = new ProjectRegistry({ home, demoDirs: [demo] });
    expect(r.byPath(demo)?.location).toBe("demo");
    expect(() => r.add(ext)).toThrow(/not a Cezane project/);
    const e = r.add(ext, { init: true });
    expect(e.location).toBe("external");
    expect(e.id).toBe("client-x");
    expect(r.add(ext).id).toBe(e.id); // same folder, same entry
    const again = new ProjectRegistry({ home, demoDirs: [demo] });
    expect(again.get("client-x")?.path).toBe(ext);
    expect(again.get("dax")?.path).toBe(demo);
  });

  test("finds folders dropped into Projets/ and lists the last opened first", () => {
    ProjectStore.init(join(home, "Projets", "Copie"), "Copie");
    const r = new ProjectRegistry({ home, demoDirs: [demo] });
    expect(r.get("copie")).toBeDefined();
    r.touch("copie");
    expect(r.list()[0]!.id).toBe("copie");
  });

  test("forget hides a project until it is opened again; folders are never touched", () => {
    const r = new ProjectRegistry({ home, demoDirs: [demo] });
    const path = r.get("mon-reel")!.path;
    expect(r.forget("mon-reel")).toBe(true);
    expect(r.forget("nope")).toBe(false);
    expect(existsSync(join(path, "cezane.json"))).toBe(true);
    expect(new ProjectRegistry({ home, demoDirs: [demo] }).byPath(path)).toBeUndefined(); // not re-discovered
    const back = new ProjectRegistry({ home, demoDirs: [demo] }).add(path);
    expect(back.location).toBe("projets");
  });

  test("one entry per folder, even through a symlink; ids never shadow /api/projects/events|open", () => {
    const r = new ProjectRegistry({ home, demoDirs: [demo] });
    const ext = join(t.dir, "ailleurs/Client X");
    symlinkSync(join(t.dir, "ailleurs"), join(t.dir, "raccourci"));
    expect(r.add(join(t.dir, "raccourci/Client X")).id).toBe(r.byPath(ext)!.id);
    expect(r.create("events").id).toBe("events-2");
  });

  test("drops demo entries whose checkout is gone", () => {
    const gone = join(t.dir, "old-checkout/demo/rewind");
    ProjectStore.init(gone, "Rewind");
    expect(new ProjectRegistry({ home, demoDirs: [demo, gone] }).byPath(gone)).toBeDefined();
    rmSync(join(t.dir, "old-checkout"), { recursive: true });
    expect(new ProjectRegistry({ home, demoDirs: [demo] }).byPath(gone)).toBeUndefined();
    mkdirSync(home, { recursive: true });
  });
});
