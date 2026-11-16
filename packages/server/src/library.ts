import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { Asset, FilesListing, FolderNode, MediaFolderName, ProjectFile, Version } from "@cezane/core";
import { ALL_FOLDERS, isIgnoredFile, kindOfFile, listFiles, nfc, sha256File, WATCHED_FOLDERS } from "@cezane/engine";
import type { Cezane } from "./app";

const key = (rel: string) => nfc(rel).toLowerCase();
const stem = (rel: string) => basename(rel, extname(rel));
const inWatched = (rel: string) => WATCHED_FOLDERS.some((f) => key(rel).startsWith(`${key(f)}/`));

type Seen = { size: number; mtimeMs: number; hash?: string; dupOf?: string };

/**
 * Keeps the project's assets in step with its folders, whatever the Finder did:
 * - a new media file becomes an asset (ingested like any import), used where it is;
 * - a renamed or moved file keeps its asset (matched by content hash), and the asset name
 *   follows the file name when it was the same;
 * - a deleted file: the asset is marked `missing` when a montage or canvas uses it (renders keep
 *   working from the cache), otherwise it is set aside in .cezane/trash.json and comes back with
 *   its id if the same file reappears.
 * New files are only taken once their size stopped changing (a copy in progress).
 */
export class FolderSync {
  private seen = new Map<string, Seen>();
  private running?: Promise<void>;
  private again = false;
  private signature = "";

  constructor(private app: Cezane) {}

  /** One pass at a time; a request during a pass runs one more pass after it. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  /** The asset with the same content as this file, when the file is a duplicate that was not imported. */
  duplicateOf(rel: string): string | undefined {
    return this.seen.get(key(rel))?.dupOf;
  }

  private async pass() {
    const app = this.app;
    const s = app.store;
    const files = WATCHED_FOLDERS.flatMap((f) => listFiles(s.path(f)).map((r) => `${f}/${r}`)).filter((r) => kindOfFile(r) !== "other");
    const onDisk = new Set(files.map(key));
    const referenced = () => new Set(s.project.assets.map((a) => key(a.file)));
    let dirty = false;

    // Files put back where they were.
    for (const a of s.project.assets)
      if (a.missing && existsSync(s.path(a.file))) {
        a.missing = undefined;
        dirty = true;
      }

    // New files, once stable.
    const fresh: { rel: string; hash: string }[] = [];
    let unsettled = false;
    const refs = referenced();
    for (const rel of files) {
      const k = key(rel);
      if (refs.has(k) || app.isBusy(rel)) continue;
      let st;
      try {
        st = statSync(s.path(rel));
      } catch {
        continue;
      }
      const prev = this.seen.get(k);
      if (!prev || prev.size !== st.size || prev.mtimeMs !== st.mtimeMs) {
        this.seen.set(k, { size: st.size, mtimeMs: st.mtimeMs });
        unsettled = true;
        continue;
      }
      if (prev.dupOf && s.asset(prev.dupOf)) continue;
      prev.dupOf = undefined;
      prev.hash ??= await sha256File(s.path(rel));
      fresh.push({ rel, hash: prev.hash });
    }
    if (unsettled) app.watcher?.poke(1000);

    for (const f of fresh) {
      if (referenced().has(key(f.rel)) || app.isBusy(f.rel) || !existsSync(s.path(f.rel))) continue;
      // Renamed or moved in the Finder: same content, old file gone.
      const moved = s.project.assets.find((a) => a.hash === f.hash && inWatched(a.file) && !existsSync(s.path(a.file)));
      if (moved) {
        if (moved.name === stem(moved.file)) moved.name = stem(f.rel);
        moved.file = f.rel;
        moved.missing = undefined;
        dirty = true;
        continue;
      }
      const twin = s.project.assets.find((a) => a.hash === f.hash);
      if (twin) {
        this.seen.get(key(f.rel))!.dupOf = twin.id;
        continue;
      }
      if (s.restoreFromTrash(f.hash, f.rel)) {
        dirty = true;
        continue;
      }
      const folder = f.rel.split("/")[0];
      const abs = s.path(f.rel);
      await app
        .importFiles([abs], folder === "Captures" ? { type: "capture", source: "finder", target: basename(f.rel) } : { type: "import", path: abs })
        .catch((e) => console.error(`[watch] import ${f.rel}: ${e instanceof Error ? e.message : e}`));
    }

    // Deleted files (not while new files are still settling: they may be the same files renamed).
    if (!unsettled) {
      const gone = s.project.assets.filter((a) => !a.missing && inWatched(a.file) && !existsSync(s.path(a.file)));
      if (gone.length) {
        const usage = s.usage();
        const unused: string[] = [];
        for (const a of gone) {
          if (usage.has(a.id)) {
            a.missing = true;
            dirty = true;
          } else unused.push(a.id);
        }
        if (unused.length) {
          s.moveToTrash(unused);
          dirty = true;
        }
      }
    }

    for (const k of this.seen.keys()) if (!onDisk.has(k)) this.seen.delete(k);
    if (dirty) {
      s.saveProject();
      app.changed();
    }
    const sig = this.diskSignature();
    if (sig !== this.signature) {
      if (this.signature) app.changedFiles();
      this.signature = sig;
    }
  }

  private diskSignature(): string {
    const s = this.app.store;
    return ALL_FOLDERS.flatMap((f) =>
      listFiles(s.path(f)).map((r) => {
        try {
          const st = statSync(s.path(f, r));
          return `${f}/${r}:${st.size}:${st.mtimeMs}`;
        } catch {
          return r;
        }
      }),
    ).join("\n");
  }
}

// ───────────────────────── files API ─────────────────────────

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** The project's Finder folders as a tree, each file with what the server knows about it. */
export function projectFiles(app: Cezane): FilesListing {
  const s = app.store;
  const base = `/files/p/${encodeURIComponent(app.id)}/`;
  const cache = (a: Asset, f?: string) => (f ? `/files/cache/${encodeURIComponent(a.hash)}/${enc(f)}` : undefined);
  const byFile = new Map(s.project.assets.map((a) => [key(a.file), a]));
  const byId = new Map(s.project.assets.map((a) => [a.id, a]));
  const byExport = new Map<string, Version>(s.versions.filter((v) => v.exportFile).map((v) => [key(v.exportFile!), v]));
  const usage = s.usage();
  const montageIds = new Set(s.project.montages.map((m) => m.id));
  const usedIn = (id: string) => usage.get(id)?.filter((x) => montageIds.has(x));

  const file = (rel: string, folder: MediaFolderName): ProjectFile | undefined => {
    let st;
    try {
      st = statSync(s.path(rel));
    } catch {
      return undefined;
    }
    const name = basename(rel);
    const out: ProjectFile = {
      path: rel,
      name,
      folder,
      kind: kindOfFile(name),
      size: st.size,
      createdAt: new Date(st.birthtimeMs || st.ctimeMs).toISOString(),
      modifiedAt: new Date(st.mtimeMs).toISOString(),
      url: base + enc(rel),
    };
    const a = byFile.get(key(rel));
    if (a) {
      const poster = cache(a, a.derived.poster);
      Object.assign(out, {
        assetId: a.id,
        assetName: a.name,
        kind: a.kind,
        status: a.status,
        error: a.error,
        duration: a.duration,
        width: a.width,
        height: a.height,
        fps: a.fps,
        provenance: a.provenance,
        thumbUrl: poster ?? (a.kind === "image" ? out.url : undefined),
        posterUrl: poster,
        usedIn: usedIn(a.id),
      });
      const p = a.provenance;
      if (p.type === "generated")
        out.generated = {
          prompt: p.prompt,
          provider: p.provider,
          model: p.model,
          cost: p.cost,
          references: p.inputs.map((id) => ({ assetId: id, name: byId.get(id)?.name, path: byId.get(id)?.file })),
        };
      if (p.type === "capture") out.capture = { source: p.source, target: p.target };
    } else {
      const v = byExport.get(key(rel));
      if (v) {
        out.version = { id: v.id, n: v.n, montageId: v.montageId, summary: v.summary };
        out.duration = v.durationFrames / v.fps;
        if (v.poster) out.thumbUrl = out.posterUrl = base + enc(v.poster);
      } else if (out.kind === "image") out.thumbUrl = out.url;
      out.duplicateOf = app.sync.duplicateOf(rel);
    }
    return out;
  };

  const node = (rel: string, folder: MediaFolderName): FolderNode => {
    const n: FolderNode = { name: basename(rel), path: rel, folders: [], files: [] };
    const dir = s.path(rel);
    if (!existsSync(dir)) return n;
    const entries = readdirSync(dir, { withFileTypes: true })
      .map((e) => ({ e, name: nfc(e.name) }))
      .filter(({ name }) => !isIgnoredFile(name))
      .sort((x, y) => x.name.localeCompare(y.name, "fr", { numeric: true }));
    for (const { e, name } of entries) {
      const r = `${rel}/${name}`;
      if (e.isDirectory()) n.folders.push(node(r, folder));
      else if (e.isFile()) {
        const f = file(r, folder);
        if (f) n.files.push(f);
      }
    }
    return n;
  };

  return {
    projectId: app.id,
    root: s.dir,
    folders: ALL_FOLDERS.map((f) => node(f, f)),
    missing: s.project.assets.filter((a) => a.missing).map((a) => ({ assetId: a.id, name: a.name, path: a.file, usedIn: usedIn(a.id) ?? [] })),
  };
}
