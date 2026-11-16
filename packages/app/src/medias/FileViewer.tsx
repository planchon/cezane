import type { FilesListing, FolderNode, ProjectFile } from "@cezane/core";
import { AudioLines, ChevronDown, ChevronRight, FileX2, Folder, FolderOpen, LayoutGrid, List, Loader2, Play, Plus, SquareArrowOutUpRight, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { importFiles } from "../ui/actions";
import { Resizer, usePanelSize } from "../ui/Resizer";
import { FILE_MIME, type FileDrag, findNode, flatten, missingKey, useMedias } from "./context";
import { duration, fileSub, reveal, tildePath } from "./files";

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

/**
 * Left column of the Médias view: the project folder as the Finder shows it. Folders with their
 * counts, then the files of the open folder (grid or list). Files dropped from the Finder are
 * imported into Rushes/; a file dragged onto the canvas becomes a reference.
 */
export function FileViewer() {
  const { state } = useApp();
  const m = useMedias();
  const panel = usePanelSize("medias-files", 300, 220, 560);
  const [mode, setModeState] = useState(loadMode);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const L = m.listing;
  const root = L?.root ?? state?.dir ?? "";
  const node = L ? (findNode(L.folders, m.folder) ?? L.folders.find((f) => f.name === "Générés") ?? L.folders[0]) : undefined;
  const missing = useMemo(() => L?.missing.filter((x) => dirOf(x.path) === node?.path) ?? [], [L, node?.path]);
  const files = useMemo(() => [...(node?.files ?? [])].sort(byDate), [node]);

  // A file selected from elsewhere (a failed render's "Relier le fichier"): bring it into view.
  useEffect(() => {
    if (!m.selected) return;
    const raf = requestAnimationFrame(() => document.querySelector(".md-fv .md-f.on, .md-fv .row.sel")?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(raf);
  }, [m.selected, node?.path, L]);

  const setMode = (v: "grid" | "list") => {
    setModeState(v);
    try {
      localStorage.setItem("cezane.medias.mode", v);
    } catch {}
  };

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const importHere = (list: File[]) => {
    if (!list.length) return;
    importFiles(list);
    m.setFolder("Rushes");
  };

  return (
    <aside
      className={`fv md-fv ${over ? "drop" : ""}`}
      style={{ width: panel.size }}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        depth.current++;
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        depth.current = 0;
        setOver(false);
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        importHere(Array.from(e.dataTransfer.files));
      }}
    >
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

      <div className="md-tree">
        {L?.folders.map((n) => (
          <FolderRow key={n.path} node={n} depth={0} missing={L.missing} />
        ))}
        {!L && !m.error && <div className="empty">Chargement des dossiers…</div>}
        {m.error && <div className="empty md-err">Dossiers illisibles : {m.error}</div>}
      </div>

      {node && (
        <>
          <div className="sh md-fh">
            <span className="ell">{node.name}</span>
            <span className="r">
              {node.path === "Rushes" && (
                <button className="ib" title="Importer des fichiers dans Rushes" onClick={() => input.current?.click()}>
                  <Plus size={16} />
                </button>
              )}
              <button className={`ib ${mode === "list" ? "on" : ""}`} title="Liste" aria-pressed={mode === "list"} onClick={() => setMode("list")}>
                <List size={16} />
              </button>
              <button className={`ib ${mode === "grid" ? "on" : ""}`} title="Grille" aria-pressed={mode === "grid"} onClick={() => setMode("grid")}>
                <LayoutGrid size={16} />
              </button>
            </span>
          </div>
          <input ref={input} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => importHere(Array.from(e.target.files ?? []))} />
          <div className="scroll fill md-files">
            {node.folders.length > 0 && (
              <div className="md-sub">
                {node.folders.map((n) => (
                  <div key={n.path} className="row" onClick={() => m.setFolder(n.path)}>
                    <Folder size={16} />
                    <span className="nm">{n.name}</span>
                    <span className="r">{flatten([n]).length}</span>
                  </div>
                ))}
              </div>
            )}
            {mode === "grid" ? (
              <div className="md-grid">
                {files.map((f) => (
                  <FileTile key={f.path} f={f} />
                ))}
                {missing.map((x) => (
                  <MissingTile key={x.assetId} x={x} />
                ))}
              </div>
            ) : (
              <div className="md-list">
                {files.map((f) => (
                  <FileRow key={f.path} f={f} />
                ))}
                {missing.map((x) => (
                  <MissingRow key={x.assetId} x={x} />
                ))}
              </div>
            )}
            {!files.length && !missing.length && !node.folders.length && (
              <div className="drop-hint">{node.path.startsWith("Rushes") ? "Glisse des vidéos, images ou sons ici depuis le Finder" : emptyText[node.path] ?? "Dossier vide"}</div>
            )}
          </div>
        </>
      )}
      {over && <div className="md-drop">Déposer pour importer dans Rushes</div>}
    </aside>
  );
}

const emptyText: Record<string, string> = {
  Générés: "Les images générées sur le canvas arrivent ici",
  Captures: "Les captures du simulateur et du web arrivent ici",
  Exports: "Chaque rendu terminé arrive ici",
};

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

function dragProps(f: ProjectFile) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(FILE_MIME, JSON.stringify({ path: f.path, assetId: f.assetId } satisfies FileDrag));
      e.dataTransfer.effectAllowed = "copy";
    },
  };
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
    <div className={`md-f ${on ? "on" : ""}`} onClick={() => m.select(f.path)} title={f.name} {...dragProps(f)}>
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
    <div className={`row ${on ? "sel" : ""}`} onClick={() => m.select(f.path)} title={f.name} {...dragProps(f)}>
      <span className="md-lth">
        <Thumb f={f} />
      </span>
      <span className="nm">{f.name}</span>
      <Badge f={f} />
      <span className="r">{fileSub(f)}</span>
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
    <div className={`row miss ${on ? "sel" : ""}`} onClick={() => m.select(missingKey(x.assetId))} title={`${x.path} a été supprimé du Finder`}>
      <span className="md-lth">
        <span className="ph">
          <FileX2 size={12} />
        </span>
      </span>
      <span className="nm">{baseName(x.path)}</span>
      <span className="r md-miss">Introuvable</span>
    </div>
  );
}
