import type { Asset } from "@cezane/core";
import { AlertTriangle, Image as ImageIcon, Loader2, Music, Plus, Video } from "lucide-react";
import { useRef, useState } from "react";
import { assetThumb, uploadFiles } from "../api";
import { useApp } from "../store";
import { attempt } from "./toast";

const provenance: Record<Asset["provenance"]["type"], [string, string]> = {
  import: ["import", "prussian"],
  generated: ["généré", "terracotta"],
  capture: ["capture", "sage"],
};

export const ASSET_MIME = "application/x-cezane-asset";

export function AssetsPanel() {
  const { state, ui, setUi } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const assets = state?.project.assets ?? [];

  const upload = (files: File[]) => files.length && attempt(() => uploadFiles(files), `${files.length} fichier(s) importé(s)`);

  return (
    <aside
      className={`panel side ${over ? "drop-over" : ""}`}
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
        upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="side-head">
        <h3>Assets</h3>
        <span className="chip">{assets.length}</span>
        <div className="spacer" />
        <button className="icon-btn" title="Importer des fichiers" onClick={() => input.current?.click()}>
          <Plus size={17} />
        </button>
        <input ref={input} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => upload(Array.from(e.target.files ?? []))} />
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        <div className="asset-grid">
          {assets.map((a) => (
            <AssetTile key={a.id} a={a} selected={ui.selection?.kind === "asset" && ui.selection.id === a.id} onClick={() => setUi({ selection: { kind: "asset", id: a.id }, panel: "props" })} />
          ))}
        </div>
        {!assets.length && <div className="drop-hint">Glisse des vidéos, images ou sons ici</div>}
      </div>
    </aside>
  );
}

function AssetTile({ a, selected, onClick }: { a: Asset; selected: boolean; onClick: () => void }) {
  const thumb = assetThumb(a);
  const [broken, setBroken] = useState(false);
  const [label, tone] = provenance[a.provenance.type];
  const Icon = a.kind === "video" ? Video : a.kind === "audio" ? Music : ImageIcon;
  return (
    <div
      className={`asset ${selected ? "sel" : ""} ${a.status === "error" ? "err" : ""}`}
      title={a.error ?? a.name}
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_MIME, JSON.stringify({ id: a.id }));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {thumb && !broken ? (
        <img src={thumb} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <div className={`ph ${a.kind}`}>
          <Icon size={22} strokeWidth={1.6} />
        </div>
      )}
      <div className="badges">
        <span className={`chip ${tone}`}>{label}</span>
        {a.status === "ingesting" ? (
          <span className="chip ochre">
            <Loader2 size={10} className="spin" />
          </span>
        ) : a.status === "error" ? (
          <span className="chip apple">
            <AlertTriangle size={10} />
          </span>
        ) : a.duration ? (
          <span className="chip">{a.duration.toFixed(0)} s</span>
        ) : null}
      </div>
      <div className="meta">{a.name}</div>
    </div>
  );
}
