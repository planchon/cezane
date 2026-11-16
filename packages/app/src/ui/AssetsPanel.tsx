import type { Asset } from "@cezane/core";
import { Film, Folder, Image as ImageIcon, Loader2, Music2, Plus, Smartphone, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { assetThumb } from "../api";
import { useApp } from "../store";
import { importFiles } from "./actions";
import { clockShort } from "./format";
import { Resizer, usePanelSize } from "./Resizer";

export const ASSET_MIME = "application/x-cezane-asset";

/**
 * Médias view, left pane: the project folder and its media (provisional, until the file viewer lands).
 * Resizable from its right edge.
 */
export function AssetsPane() {
  const { state } = useApp();
  const panel = usePanelSize("medias-files", 241, 200, 400);
  const folder = state?.dir.split("/").filter(Boolean).at(-1);
  return (
    <aside className="fv" style={{ width: panel.size }}>
      <Resizer edge="right" panel={panel} />
      <div className="fv-head" title={state?.dir}>
        <Folder size={16} />
        <span className="t13 s ell" style={{ flex: "none", maxWidth: "60%" }}>
          {state?.project.name ?? "Projet"}
        </span>
        {folder && <span className="c3 ell">{folder}</span>}
      </div>
      <AssetsList />
    </aside>
  );
}

/** The project's media. Drag a row onto the canvas, drop files here to import. */
export function AssetsList() {
  const { state } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const assets = state?.project.assets ?? [];
  const imported = assets.filter((a) => a.provenance.type === "import");
  const byClaude = assets.filter((a) => a.provenance.type !== "import");

  return (
    <div
      className={`scroll fill ${over ? "drop-over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="sec">
        <div className="sh">
          Importés
          <span className="r">
            <button className="ib" title="Importer des fichiers" onClick={() => input.current?.click()}>
              <Plus size={16} />
            </button>
          </span>
        </div>
        <input ref={input} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => importFiles(Array.from(e.target.files ?? []))} />
        {imported.map((a) => (
          <AssetRow key={a.id} a={a} />
        ))}
        {!imported.length && <div className="drop-hint">Glisse des vidéos, images ou sons ici</div>}
      </div>
      {byClaude.length > 0 && (
        <div className="sec last">
          <div className="sh">Générés et captures</div>
          {byClaude.map((a) => (
            <AssetRow key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetRow({ a }: { a: Asset }) {
  const { ui, setUi } = useApp();
  const thumb = assetThumb(a);
  const [broken, setBroken] = useState(false);
  const selected = ui.selection?.kind === "asset" && ui.selection.id === a.id;
  const Icon = a.kind === "audio" ? Music2 : a.provenance.type === "capture" ? Smartphone : a.provenance.type === "generated" ? Sparkles : a.kind === "image" ? ImageIcon : Film;
  return (
    <div
      className={`row ${selected ? "sel" : ""} ${a.status === "error" ? "off" : ""}`}
      title={a.error ?? a.name}
      onClick={() => setUi({ selection: { kind: "asset", id: a.id }, panel: "props" })}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_MIME, JSON.stringify({ id: a.id }));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {thumb && !broken ? (
        <img className="th" src={thumb} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <span className="th-ph">
          <Icon size={16} />
        </span>
      )}
      <span className="nm">{a.name}</span>
      {a.status === "ingesting" ? (
        <span className="bd">
          <Loader2 size={10} className="spin" /> import
        </span>
      ) : a.status === "error" ? (
        <span className="bd r">erreur</span>
      ) : a.duration ? (
        <span className="r">{clockShort(a.duration, 1)}</span>
      ) : null}
    </div>
  );
}
