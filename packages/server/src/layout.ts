import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Provenance } from "@cezane/core";
import { captureSlug, counterName, FOLDERS, type MediaFolder, nfc, promptSlug, safeFileName, slugify, uniqueName } from "@cezane/engine";

/**
 * Project folder layout v2 (Finder-friendly): media in Rushes/, Générés/, Captures/, renders
 * linked into Exports/. v1 kept every media file as media/<hash>.<ext>.
 */
export const LAYOUT_VERSION = 2;
export type LayoutDoc = { version: number; migratedAt?: string; moves: Record<string, string> };

export const layoutPath = (dir: string) => join(dir, ".cezane/layout.json");

export function readLayout(dir: string): LayoutDoc | undefined {
  const p = layoutPath(dir);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as LayoutDoc) : undefined;
}

export function writeLayout(dir: string, doc: LayoutDoc) {
  mkdirSync(join(dir, ".cezane"), { recursive: true });
  writeAtomic(layoutPath(dir), JSON.stringify(doc, null, 2));
}

export function writeAtomic(path: string, text: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Where an asset's file belongs. */
export function folderFor(p: Provenance): MediaFolder {
  return p.type === "generated" ? FOLDERS.generated : p.type === "capture" ? FOLDERS.captures : FOLDERS.rushes;
}

/** False for names nobody can read: content hashes, internal ids ("capture-c_676rrb", "u_x1y2z3-…"). */
export function readableName(name: string | undefined): name is string {
  if (!name?.trim()) return false;
  const n = name.trim();
  return !/^[0-9a-f]{12,}$/i.test(n) && !/^(capture|look|ctx|out)-[a-z]_\w+$/i.test(n) && !/^(out|capture|image|file|untitled|sans titre)$/i.test(n);
}

/** Original file name of an import, without the upload prefix (`u_abc123-plage.mov` → `plage.mov`). */
export function originalName(path: string): string {
  return nfc(basename(path)).replace(/^u_[a-z0-9]{4,8}-/, "");
}

/**
 * File name (inside its folder) for an asset whose stored file has extension `ext`.
 * Imports keep their original name ("plage.mov", then "plage 2.mov"); generations are
 * `<prompt-slug>-01.png`; captures keep a readable name or become `<target-slug>-01.png`.
 */
export function fileNameFor(a: { name?: string; provenance: Provenance }, ext: string, dir: string, reserved?: Set<string>): string {
  const e = ext.toLowerCase();
  const p = a.provenance;
  if (p.type === "generated") return counterName(dir, promptSlug(p.prompt), e, reserved);
  if (p.type === "capture") {
    if (readableName(a.name)) return uniqueName(dir, `${a.name}${e}`, reserved);
    return counterName(dir, captureSlug(p.target), e, reserved);
  }
  const orig = originalName(p.path);
  const oext = extname(orig);
  const stem = basename(orig, oext);
  if (readableName(stem)) return uniqueName(dir, oext.toLowerCase() === e ? orig : `${stem}${e}`, reserved);
  return uniqueName(dir, `${readableName(a.name) ? a.name : "rush"}${e}`, reserved);
}

/** Slug of a reel for its exports: the montage name, or the project name for an unnamed "Montage". */
export function reelSlug(projectName: string, montageName?: string): string {
  const generic = !montageName || /^montage( \d+)?$/i.test(montageName.trim());
  return slugify(generic ? projectName : montageName, 40) || "reel";
}

/** Hard link when possible (same volume: no extra disk space), copy otherwise. */
export function linkOrCopy(src: string, dest: string) {
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
}

/** Exports/<reel-slug>-v<n>.mp4 for a rendered version. Returns the project-relative path. */
export function exportRender(dir: string, renderFile: string, slug: string, n: number): string {
  const exports = join(dir, FOLDERS.exports);
  mkdirSync(exports, { recursive: true });
  const name = uniqueName(exports, safeFileName(`${slug}-v${n}.mp4`));
  linkOrCopy(join(dir, renderFile), join(exports, name));
  return `${FOLDERS.exports}/${name}`;
}
