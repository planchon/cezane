import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSlug, counterName, isIgnoredFile, kindOfFile, listFiles, promptSlug, safeFileName, slugify, uniqueName } from "./naming";

const dir = mkdtempSync(join(tmpdir(), "cezane-naming-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("naming", () => {
  test("slugs", () => {
    expect(slugify("Fond de studio, lumière douce !")).toBe("fond-de-studio-lumiere-douce");
    expect(promptSlug("Un fond de studio blanc, lumière douce")).toBe("fond-studio-blanc");
    expect(promptSlug("A vertical 9:16 painting in the style of Paul Cézanne: a film camera")).toBe("paul-cezanne-film");
    expect(promptSlug("!!!")).toBe("generation");
    expect(captureSlug("https://www.rewind.codes/")).toBe("rewind-codes");
    expect(captureSlug("https://docs.rewind.codes/how-it-works")).toBe("docs-rewind-codes-how-it-works");
    expect(captureSlug("simulator")).toBe("simulateur");
  });

  test("safe file names keep accents and spaces", () => {
    expect(safeFileName("Plage d'été: 2/3.mov")).toBe("Plage d'été- 2-3.mov");
    expect(safeFileName(".cache")).toBe("cache");
    expect(safeFileName("été.png")).toBe("été.png"); // NFD → NFC
  });

  test("Finder-style collisions: name 2, name 3", () => {
    writeFileSync(join(dir, "plage.mov"), "a");
    expect(uniqueName(dir, "plage.mov")).toBe("plage 2.mov");
    writeFileSync(join(dir, "plage 2.mov"), "b");
    expect(uniqueName(dir, "PLAGE.mov")).toBe("PLAGE 3.mov"); // case-insensitive like APFS
    expect(uniqueName(dir, "plage.mov", new Set(["plage 3.mov"]))).toBe("plage 4.mov");
    expect(uniqueName(dir, "neuf.mov")).toBe("neuf.mov");
  });

  test("counters: slug-01, slug-02, after the highest", () => {
    expect(counterName(dir, "fond-studio", ".png")).toBe("fond-studio-01.png");
    writeFileSync(join(dir, "fond-studio-01.png"), "a");
    writeFileSync(join(dir, "fond-studio-07.jpg"), "a");
    expect(counterName(dir, "fond-studio", "PNG")).toBe("fond-studio-08.png");
    expect(counterName(dir, "fond-studio", ".png", new Set(["fond-studio-08.png"]))).toBe("fond-studio-09.png");
  });

  test("kinds and ignored files", () => {
    expect(kindOfFile("a.MOV")).toBe("video");
    expect(kindOfFile("a.heic")).toBe("image");
    expect(kindOfFile("a.m4a")).toBe("audio");
    expect(kindOfFile("a.events.json")).toBe("other");
    for (const n of [".DS_Store", "a.mov.part", "a.crdownload", "x.events.json", "out.tmp.mp4", "~lock"]) expect(isIgnoredFile(n)).toBe(true);
    expect(isIgnoredFile("plage 2.mov")).toBe(false);
    writeFileSync(join(dir, ".DS_Store"), "");
    expect(listFiles(dir).sort()).toEqual(["fond-studio-01.png", "fond-studio-07.jpg", "plage 2.mov", "plage.mov"]);
  });
});
