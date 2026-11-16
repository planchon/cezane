import { AudioLines, Clapperboard, ImageIcon, Loader2, RefreshCw, Type } from "lucide-react";
import { useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, T, type TLShape, useEditor } from "tldraw";
import { assetMedia, brandUrl } from "../api";
import { useApp } from "../store";
import { CARD_SIZE, runCard } from "./generation";

export type GenKind = "image" | "video" | "text" | "audio";
export type GenStatus = "idle" | "running" | "done" | "error" | "stale";

type GenCardProps = {
  w: number;
  h: number;
  kind: string;
  prompt: string;
  provider: string;
  model: string;
  status: string;
  jobId: string;
  assetId: string; // asset of the chosen version
  versions: string[]; // asset ids (image/video/audio) or text results (text)
  chosen: number;
  error: string;
};

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    "gen-card": GenCardProps;
  }
}

export type GenCardShape = TLShape<"gen-card">;


/** A generation card: a prompt + its inputs (arrows pointing to it) → versions of a result. */
export class GenCardUtil extends BaseBoxShapeUtil<GenCardShape> {
  static override type = "gen-card" as const;
  static override props: RecordProps<GenCardShape> = {
    w: T.number,
    h: T.number,
    kind: T.string,
    prompt: T.string,
    provider: T.string,
    model: T.string,
    status: T.string,
    jobId: T.string,
    assetId: T.string,
    versions: T.arrayOf(T.string),
    chosen: T.number,
    error: T.string,
  };

  getDefaultProps(): GenCardShape["props"] {
    return { ...CARD_SIZE.image, kind: "image", prompt: "", provider: "codex", model: "gpt-image", status: "idle", jobId: "", assetId: "", versions: [], chosen: 0, error: "" };
  }

  override canEdit() {
    return true;
  }

  override getText(shape: GenCardShape) {
    return shape.props.kind === "text" ? shape.props.versions[shape.props.chosen] : shape.props.prompt;
  }

  component(shape: GenCardShape) {
    return (
      <HTMLContainer style={{ pointerEvents: "all" }}>
        <GenCard shape={shape} />
      </HTMLContainer>
    );
  }

  getIndicatorPath(shape: GenCardShape) {
    const p = new Path2D();
    p.roundRect(0, 0, shape.props.w, shape.props.h, 5);
    return p;
  }
}

const KindIcon = ({ kind }: { kind: string }) =>
  kind === "video" ? <Clapperboard size={16} /> : kind === "text" ? <Type size={16} /> : kind === "audio" ? <AudioLines size={16} /> : <ImageIcon size={16} />;

const kindLabel: Record<string, string> = { image: "Image", video: "Vidéo", text: "Texte", audio: "Audio" };

function GenCard({ shape }: { shape: GenCardShape }) {
  const editor = useEditor();
  const { state } = useApp();
  const p = shape.props;
  const editing = editor.getEditingShapeId() === shape.id;
  const [draft, setDraft] = useState(p.prompt);
  const asset = p.assetId ? state?.project.assets.find((a) => a.id === p.assetId) : undefined;
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  const update = (props: Partial<GenCardShape["props"]>) => editor.updateShape({ id: shape.id, type: "gen-card", props });

  const choose = (i: number) => {
    const v = p.versions[i];
    update({ chosen: i, assetId: p.kind === "text" ? "" : (v ?? "") });
  };

  let body: React.ReactNode;
  if (p.status === "running")
    body = (
      <div className="wait">
        <img src={brandUrl("loading.gif")} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        <span>
          <Loader2 size={12} className="spin" style={{ verticalAlign: -2 }} /> Génération…
        </span>
      </div>
    );
  else if (p.kind === "text" && p.versions[p.chosen])
    body = (
      <div className="txt" onPointerDown={stop} onWheel={stop}>
        {p.versions[p.chosen]}
      </div>
    );
  else if (asset && p.kind === "video") body = <video src={assetMedia(asset)} muted loop autoPlay playsInline />;
  else if (asset && p.kind === "audio") body = <audio src={assetMedia(asset)} controls onPointerDown={stop} style={{ width: "90%" }} />;
  else if (asset) body = <img src={assetMedia(asset)} alt="" draggable={false} />;
  else
    body = (
      <div className="wait">
        <KindIcon kind={p.kind} />
        <span>{p.status === "error" ? p.error || "Échec" : "Pas encore généré"}</span>
      </div>
    );

  return (
    <div className={`gen-card ${p.status}`}>
      <div className="gh">
        <KindIcon kind={p.kind} />
        {kindLabel[p.kind] ?? p.kind}
        <span className="model">· {p.provider}/{p.model}</span>
        {p.status === "stale" && <span className="bd y">à régénérer</span>}
        {p.status === "error" && <span className="bd r">erreur</span>}
      </div>
      <div className="gb">{body}</div>
      <div className="gf">
        {editing ? (
          <textarea
            rows={3}
            autoFocus
            value={draft}
            onPointerDown={stop}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => update({ prompt: draft })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                update({ prompt: draft });
                editor.setEditingShape(null);
              }
              if (e.key === "Escape") editor.setEditingShape(null);
            }}
          />
        ) : (
          <div className="prompt" title="Double-clic pour modifier le prompt">{p.prompt || <span className="c3">Double-clic pour écrire un prompt</span>}</div>
        )}
        <div className="gactions">
          <div className="vers">
            {p.versions.map((_, i) => (
              <button key={i} className={i === p.chosen ? "on" : ""} onPointerDown={stop} onClick={() => choose(i)} title={`Version ${i + 1}`}>
                {i + 1}
              </button>
            ))}
          </div>
          <button
            className="btn"
            disabled={p.status === "running" || !p.prompt.trim()}
            onPointerDown={stop}
            onClick={() => runCard(editor, shape.id)}
            title={p.versions.length ? "Nouvelle version" : "Générer"}
          >
            <RefreshCw size={12} /> {p.versions.length ? "Regénérer" : "Générer"}
          </button>
        </div>
      </div>
    </div>
  );
}
