import type { Asset } from "@cezane/core";
import { AudioLines, ImageIcon, Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, T, type TLShape, useEditor, useValue } from "tldraw";
import { assetThumb } from "../api";
import { useApp } from "../store";
import { duration, formatCost } from "../medias/files";
import { useMedias } from "../medias/context";
import { cleanPrompt, ratioNum, REF_LABEL, runCard } from "./generation";

export type GenKind = "image" | "video" | "text" | "audio";

/** Props of a generation card. Kept identical to the cards saved by the older canvas and by Claude's `canvas` tool. */
type GenCardProps = {
  w: number;
  h: number;
  kind: string; // image | video | text | audio | capture-ios | capture-web
  prompt: string; // the prompt; a capture's file name (simulator) or URL (web)
  provider: string;
  model: string;
  status: string; // idle | running | done | error | stale
  jobId: string;
  assetId: string; // asset of the chosen variant
  versions: string[]; // asset ids (text cards: the texts)
  chosen: number;
  error: string;
};

/** Card settings kept in the shape's meta (no schema migration needed). */
export type CardMeta = {
  ratio?: string; // "9:16"
  refs?: string[]; // reference asset ids
  capture?: { mode?: "screenshot" | "video"; seconds?: number };
  by?: string;
};

type MediaRefProps = { w: number; h: number; assetId: string; name: string };

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    "gen-card": GenCardProps;
    "media-ref": MediaRefProps;
  }
}

export type GenCardShape = TLShape<"gen-card">;
export type MediaRefShape = TLShape<"media-ref">;

// ───────────────────────── geometry ─────────────────────────

const COLS = 4;
const GAP = 6;
const MIN_W = 262; // the prompt (two lines) and the footer: chip, "2 variantes · abonnement", new variant
const CHROME_H = 84; // padding, prompt (2 lines), footer

/** Size of one result tile: 170 px tall for portrait/square results, 200 px wide for landscape ones. */
export function tileSize(kind: string, ratio: number): { w: number; h: number } {
  if (kind === "text") return { w: 300, h: 170 };
  if (kind === "audio") return { w: 170, h: 96 };
  if (ratio <= 1) return { w: Math.round(170 * ratio), h: 170 };
  return { w: 200, h: Math.round(200 / ratio) };
}

export function cardSize(kind: string, ratio: number, tiles: number): { w: number; h: number } {
  const t = tileSize(kind, ratio);
  const n = Math.max(1, tiles);
  const cols = Math.min(n, COLS);
  const rows = Math.ceil(n / COLS);
  return { w: Math.max(cols * t.w + (cols - 1) * GAP, MIN_W) + 16, h: CHROME_H + rows * t.h + (rows - 1) * GAP };
}

// ───────────────────────── generation card ─────────────────────────

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
    return { ...cardSize("image", 9 / 16, 1), kind: "image", prompt: "", provider: "codex", model: "gpt-image", status: "idle", jobId: "", assetId: "", versions: [], chosen: 0, error: "" };
  }

  override canEdit() {
    return true;
  }

  override canResize() {
    return false;
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
    p.roundRect(0, 0, shape.props.w, shape.props.h, 13);
    return p;
  }
}

const kindChip = (kind: string, ratio?: string) =>
  kind === "capture-ios"
    ? "Capture simulateur"
    : kind === "capture-web"
      ? `Capture web${ratio ? ` · ${ratio}` : ""}`
      : kind === "video"
        ? "Vidéo"
        : kind === "text"
          ? "Texte"
          : kind === "audio"
            ? "Audio"
            : `Image${ratio ? ` · ${ratio}` : ""}`;

const isCapture = (kind: string) => kind.startsWith("capture-");

function GenCard({ shape }: { shape: GenCardShape }) {
  const editor = useEditor();
  const { state } = useApp();
  const m = useMedias();
  const p = shape.props;
  const meta = (shape.meta ?? {}) as CardMeta;
  const editing = useValue("editing", () => editor.getEditingShapeId() === shape.id, [editor, shape.id]);
  const [draft, setDraft] = useState(p.prompt);
  useEffect(() => {
    if (editing) setDraft(p.prompt);
  }, [editing, p.prompt]);
  const assets = state?.project.assets ?? [];
  const assetOf = (id: string) => assets.find((a) => a.id === id);
  const running = p.status === "running";
  const job = running && p.jobId ? state?.jobs.find((j) => j.id === p.jobId) : undefined;
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  // Tiles share the card's ratio, or the first result's when the card has none (older cards).
  const first = p.kind !== "text" ? assetOf(p.versions[0] ?? "") : undefined;
  const ratio = meta.ratio ? ratioNum(meta.ratio) : first?.width && first.height ? first.width / first.height : 9 / 16;
  const tiles = p.versions.length + (running ? 1 : 0);
  const size = cardSize(p.kind, ratio, tiles);
  const tile = tileSize(p.kind, ratio);

  // The card grows with its variants.
  useEffect(() => {
    if (Math.abs(size.w - p.w) > 0.5 || Math.abs(size.h - p.h) > 0.5) editor.updateShape({ id: shape.id, type: "gen-card", props: { w: size.w, h: size.h } });
  }, [editor, shape.id, size.w, size.h, p.w, p.h]);

  const choose = (i: number) => {
    const v = p.versions[i];
    editor.updateShape({ id: shape.id, type: "gen-card", props: { chosen: i, assetId: p.kind === "text" ? "" : (v ?? "") } });
    if (v && p.kind !== "text") m.selectAsset(v);
  };

  const cost = p.versions.reduce((sum, id) => {
    const a = assetOf(id);
    return sum + (a?.provenance.type === "generated" ? (a.provenance.cost ?? 0) : 0);
  }, 0);
  const n = p.versions.length;
  const capture = isCapture(p.kind);
  const summary = capture
    ? `${n} capture${n > 1 ? "s" : ""}`
    : `${n} variante${n > 1 ? "s" : ""} · ${cost > 0 ? formatCost(cost) : p.provider === "codex" || p.provider === "claude" ? "abonnement" : formatCost(0)}`;
  const promptText =
    p.kind === "capture-ios" ? `Capture du simulateur${p.prompt.trim() ? ` : ${p.prompt.trim()}` : ""}` : p.kind === "capture-web" ? `Capture web : ${p.prompt}` : cleanPrompt(p.prompt);

  return (
    <div className={`md-card ${p.status}`}>
      <div className="md-pr">
        <span className="av cl xs">C</span>
        {editing ? (
          <textarea
            rows={2}
            autoFocus
            value={draft}
            onPointerDown={stop}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => editor.updateShape({ id: shape.id, type: "gen-card", props: { prompt: draft } })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                editor.updateShape({ id: shape.id, type: "gen-card", props: { prompt: draft } });
                editor.setEditingShape(null);
              }
              if (e.key === "Escape") editor.setEditingShape(null);
            }}
          />
        ) : (
          <span className="txt" title={promptText}>
            {promptText || <span className="c3">Double-clic pour écrire un prompt</span>}
          </span>
        )}
      </div>
      <div className="md-tiles" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(1, tiles), COLS)}, ${tile.w}px)`, gridAutoRows: tile.h }}>
        {p.versions.map((v, i) => (
          <ResultTile key={`${i}-${v}`} kind={p.kind} value={v} asset={p.kind === "text" ? undefined : assetOf(v)} on={i === p.chosen} onPick={() => choose(i)} stop={stop} />
        ))}
        {running && (
          <div className="md-tile wait">
            <span>{capture ? (meta.capture?.mode === "video" ? "Enregistrement…" : "Capture…") : "Génération…"}</span>
          </div>
        )}
        {!tiles && (
          <div className="md-tile empty">
            <ImageIcon size={16} />
            <span>{p.status === "error" ? "Échec" : "Pas encore généré"}</span>
          </div>
        )}
      </div>
      <div className="md-gf">
        {running ? (
          <>
            <span className="bd c">{kindChip(p.kind, meta.ratio)}</span>
            <div className={`md-bar ${job && job.progress > 0 ? "" : "indet"}`}>
              <i style={job && job.progress > 0 ? { width: `${Math.round(job.progress * 100)}%` } : undefined} />
            </div>
          </>
        ) : (
          <>
            <span className="bd">{kindChip(p.kind, meta.ratio)}</span>
            {p.status === "error" ? (
              <span className="err ell" title={p.error}>
                {p.error || "Échec"}
              </span>
            ) : p.status === "stale" ? (
              <span className="bd y">à régénérer</span>
            ) : n > 0 ? (
              <span className="c2 ell">{summary}</span>
            ) : null}
          </>
        )}
        <span className="sp" />
        {!running && (
          <button
            className="ib"
            disabled={!capture && !p.prompt.trim()}
            onPointerDown={stop}
            onClick={() => void runCard(editor, shape.id)}
            title={n ? (capture ? "Capturer de nouveau" : "Nouvelle variante") : capture ? "Capturer" : "Générer"}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function ResultTile({ kind, value, asset, on, onPick, stop }: { kind: string; value: string; asset?: Asset; on: boolean; onPick: () => void; stop: (e: React.PointerEvent) => void }) {
  const m = useMedias();
  if (kind === "text")
    return (
      <div className={`md-tile text ${on ? "on" : ""}`} onPointerDown={stop} onClick={onPick} onWheel={(e) => e.stopPropagation()}>
        {value}
      </div>
    );
  const file = m.byAsset.get(value);
  const thumb = file?.thumbUrl ?? (asset ? assetThumb(asset) : undefined);
  return (
    <div className={`md-tile ${on ? "on" : ""}`} onPointerDown={stop} onClick={onPick} title={file?.name ?? asset?.name}>
      {asset?.kind === "audio" ? (
        <AudioLines size={16} />
      ) : thumb ? (
        <img src={thumb} alt="" draggable={false} />
      ) : (
        <span className="c3">{asset ? "Import…" : "Introuvable"}</span>
      )}
      {asset?.kind === "video" && (
        <span className="md-dur">
          <Play size={8} fill="currentColor" />
          {asset.duration ? duration(asset.duration) : ""}
        </span>
      )}
    </div>
  );
}

// ───────────────────────── reference ─────────────────────────

/** A project file placed on the canvas: its name above, the picture below. */
export class MediaRefUtil extends BaseBoxShapeUtil<MediaRefShape> {
  static override type = "media-ref" as const;
  static override props: RecordProps<MediaRefShape> = { w: T.number, h: T.number, assetId: T.string, name: T.string };

  getDefaultProps(): MediaRefShape["props"] {
    return { w: 110, h: 196 + REF_LABEL, assetId: "", name: "" };
  }

  override isAspectRatioLocked() {
    return true;
  }

  component(shape: MediaRefShape) {
    return (
      <HTMLContainer>
        <MediaRef shape={shape} />
      </HTMLContainer>
    );
  }

  getIndicatorPath(shape: MediaRefShape) {
    const p = new Path2D();
    p.rect(0, REF_LABEL, shape.props.w, shape.props.h - REF_LABEL);
    return p;
  }
}

function MediaRef({ shape }: { shape: MediaRefShape }) {
  const { state } = useApp();
  const m = useMedias();
  const editor = useEditor();
  const selected = useValue("sel", () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id]);
  const asset = state?.project.assets.find((a) => a.id === shape.props.assetId);
  const file = m.byAsset.get(shape.props.assetId);
  const thumb = file?.thumbUrl ?? (asset ? assetThumb(asset) : undefined);
  const name = file?.name ?? asset?.name ?? shape.props.name;
  const isRef = m.refs.includes(shape.props.assetId);
  return (
    <div className="md-ref">
      <div className={`fl ${selected ? "on" : ""}`}>
        <span className="ell">{name}</span>
        {isRef && <span style={{ flex: "none" }}>· référence</span>}
      </div>
      <div className="md-ref-fr">
        {asset?.kind === "audio" ? <AudioLines size={16} /> : thumb ? <img src={thumb} alt="" draggable={false} /> : <span className="c3">{asset ? "Import…" : "Introuvable"}</span>}
      </div>
    </div>
  );
}
