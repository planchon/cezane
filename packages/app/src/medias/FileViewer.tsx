import type { FilesListing, FolderNode, ProjectFile } from "@cezane/core";
import { AudioLines, ChevronDown, ChevronRight, FileX2, Folder, FolderOpen, LayoutGrid, List, Loader2, Play, Plus, SquareArrowOutUpRight, TriangleAlert } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { relTime } from "../ui/format";
import { Resizer, usePanelSize } from "../ui/Resizer";
import { findNode, flatten, missingKey, useMedias } from "./context";
import { duration, fileSub, formatSize, reveal, tildePath } from "./files";

type Missing = FilesListing["missing"][number];

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
const baseName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;
const byDate = (a: ProjectFile, b: ProjectFile) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name, "fr");

const loadMode = (): "grid" | "list" => {
  try {
    return localStorage.getItem("cezane.medias.mode") === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};

/** The open folder of the listing (Générés when the remembered one is gone). */
function useNode() {
  const m = useMedias();
  const L = m.listing;
  return L ? (findNode(L.folders, m.folder) ?? L.folders.find((f) => f.name === "Générés") ?? L.folders[0]) : undefined;
}

// ───────────────────────── sidebar: the folders ─────────────────────────

/** Left column of the Médias tab: the project folder and its folders, as the Finder's sidebar. */
export function FolderSidebar() {
  const { state } = useApp();
  const m = useMedias();
  const panel = usePanelSize("medias-folders", 241, 180, 400);
  const L = m.listing;
  const root = L?.root ?? state?.dir ?? "";
  return (
    <aside className="fv md-side" style={{ width: panel.size }}>
      <Resizer edge="right" panel={panel} />
      <div className="fv-head" title={root}>
        <Folder size={16} />
        <span className="t13 s ell" style={{ flex: "none", maxWidth: "55%" }}>
          {baseName(root) || state?.project.name || "Projet"}
        </span>
        <span className="c3 ell">{tildePath(root)}</span>
        <span className="sp" />
        <button className="ib" title="Afficher dans le Finder" onClick={() => void reveal()}>
          <SquareArrowOutUpRight size={16} />
        </button>
      </div>
      <div className="scroll fill md-tree">
        {L?.folders.map((n) => (
          <FolderRow key={n.path} node={n} depth={0} missing={L.missing} />
        ))}
        {!L && !m.error && <div className="empty">Chargement des dossiers…</div>}
        {m.error && <div className="empty md-err">Dossiers illisibles : {m.error}</div>}
      </div>
    </aside>
  );
}

function FolderRow({ node, depth, missing }: { node: FolderNode; depth: number; missing: Missing[] }) {
  const m = useMedias();
  const on = m.folder === node.path;
  const inside = m.folder.startsWith(`${node.path}/`);
  const [open, setOpen] = useState(inside);
  const count = useMemo(() => flatten([node]).length, [node]);
  const lost = missing.filter((x) => x.path.startsWith(`${node.path}/`)).length;
  const subs = node.folders.length > 0;
  const expanded = subs && (open || inside);
  const Icon = on ? FolderOpen : Folder;
  return (
    <>
      <div
        className={`row ${on ? "sel" : ""}`}
        style={{ "--i": depth } as React.CSSProperties}
        onClick={() => {
          m.setFolder(node.path);
          if (subs) setOpen(true);
        }}
      >
        <span className="dis">
          {subs && (
            <button
              className="dis"
              aria-label={expanded ? "Replier" : "Déplier"}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(!expanded);
              }}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          )}
        </span>
        <Icon size={16} style={node.path === "Générés" ? { color: "var(--c-500)" } : undefined} />
        <span className={`nm ${on ? "s" : ""}`}>{node.name}</span>
        {lost > 0 && (
          <span className="md-lost" title={`${lost} fichier${lost > 1 ? "s" : ""} introuvable${lost > 1 ? "s" : ""}`}>
            <TriangleAlert size={12} />
          </span>
        )}
        <span className="r">{count}</span>
      </div>
      {expanded && node.folders.map((n) => <FolderRow key={n.path} node={n} depth={depth + 1} missing={missing} />)}
    </>
  );
}

// ───────────────────────── centre: the files of the open folder ─────────────────────────

const emptyText: Record<string, string> = {
  Générés: "Les images générées sur le canvas arrivent ici",
  Captures: "Les captures du simulateur et du web arrivent ici",
  Exports: "Chaque rendu terminé arrive ici",
};

/**
 * Centre of the Médias tab: the open folder (breadcrumb, grid or list) under the view switcher.
 * Clicking the background clears the selection, as in the Finder.
 */
export function FileBrowser({ onImport }: { onImport: (files: File[]) => void }) {
  const m = useMedias();
  const node = useNode();
  const [mode, setModeState] = useState(loadMode);
  const input = useRef<HTMLInputElement>(null);
  const L = m.listing;
  const missing = useMemo(() => L?.missing.filter((x) => dirOf(x.path) === node?.path) ?? [], [L, node?.path]);
  const files = useMemo(() => [...(node?.files ?? [])].sort(byDate), [node]);

  // A file selected from elsewhere (canvas, a failed render's "Relier le fichier"): bring it into view.
  useEffect(() => {
    if (!m.selected) return;
    const raf = requestAnimationFrame(() => document.querySelector(".md-browser .md-f.on, .md-browser .row.sel")?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(raf);
  }, [m.selected, node?.path, L]);

  const setMode = (v: "grid" | "list") => {
    setModeState(v);
    try {
      localStorage.setItem("cezane.medias.mode", v);
    } catch {}
  };

  const crumbs = node ? node.path.split("/").map((name, i, all) => ({ name, path: all.slice(0, i + 1).join("/") })) : [];
  const n = files.length + missing.length;
  const clear = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) m.select(undefined);
  };

  return (
    <>
      <div className="md-bh">
        <div className="md-crumbs">
          {crumbs.map((c, i) => (
            <Fragment key={c.path}>
              {i > 0 && <ChevronRight size={12} className="sepc" />}
              {i < crumbs.length - 1 ? (
                <button className="md-crumb c2" onClick={() => m.setFolder(c.path)}>
                  {c.name}
                </button>
              ) : (
                <span className="t13 s ell">{c.name}</span>
              )}
            </Fragment>
          ))}
          {node && (
            <span className="c3 nb">
              {n} fichier{n > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className="sp" />
        {node?.path.startsWith("Rushes") && (
          <button className="btn" title="Importer des fichiers dans Rushes" onClick={() => input.current?.click()}>
            <Plus size={12} />
            Importer
          </button>
        )}
        <div className="md-seg" role="group" aria-label="Présentation">
          <button className={`ib ${mode === "grid" ? "on" : ""}`} title="Grille" aria-pressed={mode === "grid"} onClick={() => setMode("grid")}>
            <LayoutGrid size={16} />
          </button>
          <button className={`ib ${mode === "list" ? "on" : ""}`} title="Liste" aria-pressed={mode === "list"} onClick={() => setMode("list")}>
            <List size={16} />
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept="video/*,image/*,audio/*"
          onChange={(e) => {
            onImport(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      <div className="scroll fill md-files" onClick={clear}>
        {!L && !m.error && <div className="empty">Chargement…</div>}
        {node && node.folders.length > 0 && (
          <div className="md-sub" onClick={clear}>
            {node.folders.map((f) => (
              <div key={f.path} className="md-subf" onClick={() => m.setFolder(f.path)} title={f.path}>
                <Folder size={16} />
                <span className="ell">{f.name}</span>
                <span className="c3">{flatten([f]).length}</span>
              </div>
            ))}
          </div>
        )}
        {mode === "grid" ? (
          n > 0 && (
            <div className="md-grid" onClick={clear}>
              {files.map((f) => (
                <FileTile key={f.path} f={f} />
              ))}
              {missing.map((x) => (
                <MissingTile key={x.assetId} x={x} />
              ))}
            </div>
          )
        ) : (
          n > 0 && (
            <div className="md-list">
              <div className="md-lrow md-lhead c2">
                <span>Nom</span>
                <span>Durée</span>
                <span>Taille</span>
                <span>Ajouté</span>
              </div>
              {files.map((f) => (
                <FileRow key={f.path} f={f} />
              ))}
              {missing.map((x) => (
                <MissingRow key={x.assetId} x={x} />
              ))}
            </div>
          )
        )}
        {node && !n && !node.folders.length && (
          <div className="drop-hint md-empty">{node.path.startsWith("Rushes") ? "Glisse des vidéos, images ou sons ici depuis le Finder" : (emptyText[node.path] ?? "Dossier vide")}</div>
        )}
      </div>
    </>
  );
}

function Thumb({ f }: { f: ProjectFile }) {
  const [broken, setBroken] = useState(false);
  const src = f.thumbUrl ?? f.posterUrl;
  if (src && !broken) return <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />;
  return <span className="ph">{f.kind === "audio" ? <AudioLines size={16} /> : <Play size={16} />}</span>;
}

function Badge({ f }: { f: ProjectFile }) {
  if (f.status === "ingesting")
    return (
      <span className="bd md-badge">
        <Loader2 size={10} className="spin" /> import
      </span>
    );
  if (f.status === "error") return <span className="bd r md-badge" title={f.error}>erreur</span>;
  if (f.duplicateOf) return <span className="bd md-badge" title="Même contenu qu'un fichier déjà importé : pas importé deux fois">doublon</span>;
  return null;
}

function FileTile({ f }: { f: ProjectFile }) {
  const m = useMedias();
  const on = m.selected === f.path;
  return (
    <div className={`md-f ${on ? "on" : ""}`} onClick={() => m.select(f.path)} title={f.name}>
      <div className="md-th">
        <Thumb f={f} />
        <Badge f={f} />
        {f.kind === "video" && f.duration !== undefined && <span className="md-dur">{duration(f.duration)}</span>}
      </div>
      <div className="n ell">{f.name}</div>
      <div className="c3 ell">{fileSub(f)}</div>
    </div>
  );
}

function FileRow({ f }: { f: ProjectFile }) {
  const m = useMedias();
  const on = m.selected === f.path;
  return (
    <div className={`md-lrow row ${on ? "sel" : ""}`} onClick={() => m.select(f.path)} title={f.name}>
      <span className="md-lname">
        <span className="md-lth">
          <Thumb f={f} />
        </span>
        <span className="nm">{f.name}</span>
        <Badge f={f} />
      </span>
      <span className="c2">{f.version ? `V${f.version.n}${f.duration ? ` · ${duration(f.duration)}` : ""}` : f.duration && f.kind !== "image" ? duration(f.duration) : "—"}</span>
      <span className="c2">{formatSize(f.size)}</span>
      <span className="c2">{relTime(f.createdAt)}</span>
    </div>
  );
}

function MissingTile({ x }: { x: Missing }) {
  const m = useMedias();
  const on = m.selected === missingKey(x.assetId);
  return (
    <div className={`md-f miss ${on ? "on" : ""}`} onClick={() => m.select(missingKey(x.assetId))} title={`${x.path} a été supprimé du Finder`}>
      <div className="md-th">
        <span className="ph">
          <FileX2 size={16} />
        </span>
      </div>
      <div className="n ell">{baseName(x.path)}</div>
      <div className="md-miss ell">Introuvable</div>
    </div>
  );
}

function MissingRow({ x }: { x: Missing }) {
  const m = useMedias();
  const on = m.selected === missingKey(x.assetId);
  return (
    <div className={`md-lrow row miss ${on ? "sel" : ""}`} onClick={() => m.select(missingKey(x.assetId))} title={`${x.path} a été supprimé du Finder`}>
      <span className="md-lname">
        <span className="md-lth">
          <span className="ph">
            <FileX2 size={12} />
          </span>
        </span>
        <span className="nm">{baseName(x.path)}</span>
      </span>
      <span className="md-miss">Introuvable</span>
      <span />
      <span />
    </div>
  );
}
