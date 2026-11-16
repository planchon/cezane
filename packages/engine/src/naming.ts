import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

/**
 * Finder-friendly project folders. Media files live here under readable names; everything the
 * server keeps for itself stays in cezane.json, montages/, comments, versions and `.cezane/`.
 */
export const FOLDERS = {
  rushes: "Rushes", // imported footage, original file names
  generated: "Générés", // AI generations, `<prompt-slug>-01.png`
  captures: "Captures", // simulator and web captures
  exports: "Exports", // rendered versions, `<reel-slug>-v3.mp4`
} as const;
export type MediaFolder = (typeof FOLDERS)[keyof typeof FOLDERS];
/** Folders the watcher follows: files added there from the Finder become assets. */
export const WATCHED_FOLDERS: MediaFolder[] = [FOLDERS.rushes, FOLDERS.generated, FOLDERS.captures];
export const ALL_FOLDERS: MediaFolder[] = [FOLDERS.rushes, FOLDERS.generated, FOLDERS.captures, FOLDERS.exports];

const VIDEO = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mts", ".m2ts", ".3gp", ".hevc"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff", ".bmp", ".avif"]);
const AUDIO = new Set([".m4a", ".mp3", ".wav", ".aac", ".aif", ".aiff", ".flac", ".ogg", ".opus", ".caf"]);

/** Media kind from the file extension, or "other" (sidecars, documents…). */
export function kindOfFile(name: string): "video" | "image" | "audio" | "other" {
  const ext = extname(name).toLowerCase();
  return VIDEO.has(ext) ? "video" : IMAGE.has(ext) ? "image" : AUDIO.has(ext) ? "audio" : "other";
}

/** Files nobody should import: hidden, partial downloads, editor temp files, sidecars. */
export function isIgnoredFile(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.startsWith("~") ||
    name === "Icon\r" ||
    /\.(tmp|part|crdownload|download|partial|events\.json)$/i.test(name) ||
    /\.tmp\.\w+$/i.test(name)
  );
}

/** Unicode NFC: the Finder may hand back decomposed accents (NFD) for the same name. */
export const nfc = (s: string) => s.normalize("NFC");

/** Makes a string safe as a file name while keeping it readable (accents, spaces, case). */
export function safeFileName(name: string, max = 80): string {
  const s = nfc(name)
    .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+/, "")
    .trim();
  return (s.length > max ? s.slice(0, max).trim() : s) || "fichier";
}

const STOP = new Set(
  (
    "a an the of in on at to for with and or by from into over under as is are be this that its it " +
    "un une le la les de des du d l au aux et ou en pour avec sur sous dans par ce cet cette ces son sa ses qui que " +
    "image images photo picture illustration painting peinture video vidéo clip render generate génère genere create make " +
    "style vertical horizontal portrait landscape format ratio exactly one only very high quality hd 4k"
  ).split(" "),
);

/** Lowercase ASCII slug: "Fond de studio, lumière douce" → "fond-de-studio-lumiere-douce". */
export function slugify(s: string, max = 48): string {
  const slug = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  return (cut.includes("-") ? cut.slice(0, cut.lastIndexOf("-")) : cut).replace(/-+$/, "");
}

/** Short slug of a prompt: its first meaningful words ("Un fond de studio blanc…" → "fond-studio-blanc"). */
export function promptSlug(prompt: string, words = 3): string {
  const parts = slugify(prompt, 400)
    .split("-")
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w) && w.length > 1);
  return parts.slice(0, words).join("-").slice(0, 40).replace(/-+$/, "") || "generation";
}

/** Readable base name of a capture target: "https://docs.rewind.codes/how-it-works" → "docs-rewind-codes-how-it-works". */
export function captureSlug(target: string): string {
  let t = target;
  try {
    const u = new URL(target);
    t = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {}
  if (/^(simulator|booted|ios)$/i.test(t.trim())) return "simulateur";
  return slugify(t, 40) || "capture";
}

/** Names already used in a folder, compared in NFC and case-insensitively (APFS default). */
function taken(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).map((f) => nfc(f).toLowerCase()));
}

/**
 * Finder-style unique name: "plage.mov", then "plage 2.mov", "plage 3.mov"…
 * `reserved` holds names promised to other writers that may not exist on disk yet.
 */
export function uniqueName(dir: string, wanted: string, reserved: Set<string> = new Set()): string {
  const name = safeFileName(wanted);
  const ext = extname(name);
  const stem = basename(name, ext);
  const used = taken(dir);
  const free = (n: string) => !used.has(n.toLowerCase()) && !reserved.has(n.toLowerCase());
  if (free(name)) return name;
  for (let i = 2; ; i++) {
    const n = `${stem} ${i}${ext}`;
    if (free(n)) return n;
  }
}

/** Next counter name for a slug: "fond-studio-01.png", "fond-studio-02.png"… (max existing + 1). */
export function counterName(dir: string, slug: string, ext: string, reserved: Set<string> = new Set()): string {
  const e = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const re = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.[^.]+$`, "i");
  let max = 0;
  for (const f of [...taken(dir), ...reserved]) {
    const m = re.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${slug}-${String(max + 1).padStart(2, "0")}${e}`;
}

/** Recursively lists the files of a folder (relative paths, NFC), skipping ignored names. */
export function listFiles(root: string, rel = ""): string[] {
  const dir = join(root, rel);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const name = nfc(e.name);
    if (isIgnoredFile(name)) continue;
    const r = rel ? `${rel}/${name}` : name;
    if (e.isDirectory()) out.push(...listFiles(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}
