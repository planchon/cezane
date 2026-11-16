import type { GenerateRequest, Job, ModelInfo } from "@cezane/core";
import { createShapeId, type Editor, type TLAssetId, type TLShape, type TLShapeId } from "tldraw";
import { post } from "../api";
import { toast } from "../ui/toast";
import type { CardMeta, GenCardShape, GenKind } from "./shapes";

/** Set by the canvas: the open canvas and the model registry. */
export const genContext: { canvasId?: string; models: ModelInfo[] } = { models: [] };

export const isCard = (s: TLShape | undefined): s is GenCardShape => s?.type === "gen-card";

export const cardMeta = (s: GenCardShape): CardMeta => (s.meta ?? {}) as CardMeta;

// ───────────────────────── ratios ─────────────────────────

export const RATIOS = ["9:16", "4:5", "1:1", "16:9"] as const;
export type Ratio = (typeof RATIOS)[number];

export const ratioLabel: Record<Ratio, string> = { "9:16": "Vertical", "4:5": "Portrait", "1:1": "Carré", "16:9": "Paysage" };

export function ratioNum(r: string | undefined): number {
  const m = /^(\d+):(\d+)$/.exec(r ?? "");
  return m ? Number(m[1]) / Number(m[2]) : 9 / 16;
}

/** Web capture viewport for a ratio (CSS px; the screenshot is taken at 2x). */
export function viewportFor(r: Ratio): { width: number; height: number } {
  if (r === "9:16") return { width: 390, height: 693 };
  if (r === "4:5") return { width: 720, height: 900 };
  if (r === "1:1") return { width: 900, height: 900 };
  return { width: 1440, height: 810 };
}

/**
 * The generation route has no aspect-ratio field: the format is written at the end of the prompt.
 * `cleanPrompt` removes it again for display.
 */
const FORMAT_RE = /\n\nFormat \d+:\d+[^\n]*$/;
export const withFormat = (prompt: string, r: string | undefined) => (r ? `${prompt}\n\nFormat ${r} (${ratioLabel[r as Ratio]?.toLowerCase() ?? "image"}).` : prompt);
export const cleanPrompt = (prompt: string) => prompt.replace(FORMAT_RE, "");

// ───────────────────────── canvas graph ─────────────────────────

/** Cezane asset id behind a canvas shape. */
export function shapeAssetId(editor: Editor, s: TLShape): string | undefined {
  const metaAsset = s.meta?.assetId as string | undefined;
  if (isCard(s)) return s.props.kind !== "text" && s.props.assetId ? s.props.assetId : undefined;
  if (s.type === "media-ref") return (s.props as { assetId?: string }).assetId || undefined;
  if (s.type === "image" || s.type === "video") {
    // Shapes placed by the older canvas keep the Cezane asset id in their tldraw asset's meta.
    const tlAssetId = (s.props as { assetId?: string | null }).assetId;
    const a = tlAssetId ? editor.getAsset(tlAssetId as TLAssetId) : undefined;
    return (a?.meta?.assetId as string | undefined) ?? metaAsset;
  }
  return undefined;
}

export function shapeText(editor: Editor, s: TLShape): string | undefined {
  if (isCard(s)) return s.props.kind === "text" ? s.props.versions[s.props.chosen] : undefined;
  if (s.type === "text" || s.type === "note" || s.type === "geo") return editor.getShapeUtil(s).getText(s)?.trim() || undefined;
  return undefined;
}

/** Shapes at the start of arrows pointing to `id` (cards wired on the older canvas). */
export function arrowSources(editor: Editor, id: TLShapeId): TLShape[] {
  return editor
    .getBindingsToShape(id, "arrow")
    .filter((b) => b.props.terminal === "end")
    .map((b) => editor.getBindingsFromShape(b.fromId, "arrow").find((x) => x.props.terminal === "start"))
    .map((b) => (b ? editor.getShape(b.toId) : undefined))
    .filter((s): s is TLShape => Boolean(s));
}

/** Shapes at the end of arrows leaving `id`. */
export function arrowTargets(editor: Editor, id: TLShapeId): TLShape[] {
  return editor
    .getBindingsToShape(id, "arrow")
    .filter((b) => b.props.terminal === "start")
    .map((b) => editor.getBindingsFromShape(b.fromId, "arrow").find((x) => x.props.terminal === "end"))
    .map((b) => (b ? editor.getShape(b.toId) : undefined))
    .filter((s): s is TLShape => Boolean(s));
}

function inputsOf(editor: Editor, shapes: TLShape[]) {
  const assetIds: string[] = [];
  const texts: string[] = [];
  for (const s of shapes) {
    const a = shapeAssetId(editor, s);
    if (a) assetIds.push(a);
    const t = shapeText(editor, s);
    if (t) texts.push(t);
  }
  return { assetIds, texts };
}

// ───────────────────────── running a card ─────────────────────────

/**
 * Starts a card: a generation (its prompt, its references and the shapes wired into it) or a
 * capture (simulator or web page). The result is added as a new variant when the job ends.
 */
export async function runCard(editor: Editor, id: TLShapeId) {
  const card = editor.getShape(id);
  if (!isCard(card)) return;
  const p = card.props;
  const meta = cardMeta(card);
  const start = (job: Promise<Job>) => {
    editor.updateShape({ id, type: "gen-card", props: { status: "running", error: "" } });
    return job
      .then((j) => editor.updateShape({ id, type: "gen-card", props: { jobId: j.id } }))
      .catch((e: Error) => editor.updateShape({ id, type: "gen-card", props: { status: "error", error: e.message, jobId: "" } }));
  };

  if (p.kind === "capture-ios" || p.kind === "capture-web") {
    const c = meta.capture ?? {};
    const url = p.kind === "capture-web" ? normalizeUrl(p.prompt) : undefined;
    if (p.kind === "capture-web" && !url) {
      toast("Indique l'adresse de la page à capturer.");
      return;
    }
    const body = {
      target: p.kind === "capture-web" ? "web" : "ios",
      mode: c.mode ?? "screenshot",
      url,
      seconds: c.mode === "video" ? (c.seconds ?? 8) : undefined,
      ...(p.kind === "capture-web" ? viewportFor((meta.ratio as Ratio) ?? "9:16") : {}),
      name: p.kind === "capture-ios" && p.prompt.trim() ? p.prompt.trim() : undefined,
    };
    await start(post<Job>("/api/capture", body));
    return;
  }

  const model = genContext.models.find((m) => m.provider === p.provider && m.id === p.model);
  if (model && !model.available) {
    toast(`${model.label} indisponible${model.note ? ` : ${model.note}` : ""}`);
    return;
  }
  const wired = inputsOf(editor, arrowSources(editor, id));
  const inputs = [...new Set([...(meta.refs ?? []), ...wired.assetIds])];
  const base = wired.texts.length ? `${wired.texts.join("\n\n")}\n\n${p.prompt}` : p.prompt;
  const prompt = p.kind === "image" ? withFormat(base, meta.ratio) : base;
  let confirmCostEur: number | undefined;
  if (model && model.costEur > 0) {
    if (!confirm(`Cette génération coûte environ ${model.costEur.toFixed(2)} € (${model.label}). Continuer ?`)) return;
    confirmCostEur = model.costEur;
  }
  const req: GenerateRequest = { provider: p.provider, model: p.model, kind: p.kind as GenKind, prompt, inputs, canvasId: genContext.canvasId, shapeId: id, confirmCostEur };
  await start(post<Job>("/api/generate", req));
}

/** "rewind.codes" → "https://rewind.codes/"; local addresses ("localhost:5173") get http. */
export function normalizeUrl(s: string): string | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|[^/]+\.(local|test)(:|\/|$))/i.test(t);
  const u = /^[a-z]+:\/\//i.test(t) ? t : `${local ? "http" : "https"}://${t}`;
  try {
    return new URL(u).toString();
  } catch {
    return undefined;
  }
}

/**
 * Applies finished jobs to their cards; cards fed by a changed card become "à régénérer".
 * Returns the assets that just landed (for the "Enregistré dans…" toast).
 */
export function applyJobs(editor: Editor, jobs: Job[]): string[] {
  const landed: string[] = [];
  const cards = editor.getCurrentPageShapes().filter(isCard).filter((c) => c.props.status === "running" && c.props.jobId);
  for (const c of cards) {
    const job = jobs.find((j) => j.id === c.props.jobId);
    if (!job || job.status === "running" || job.status === "queued") continue;
    if (job.status === "error") {
      editor.updateShape({ id: c.id, type: "gen-card", props: { status: "error", error: job.error ?? "Échec", jobId: "" } });
      continue;
    }
    const text = c.props.kind === "text";
    const value = text ? String(job.result?.text ?? "") : String(job.result?.assetId ?? "");
    const versions = [...c.props.versions, value];
    editor.updateShape({
      id: c.id,
      type: "gen-card",
      props: { status: "done", jobId: "", versions, chosen: versions.length - 1, assetId: text ? "" : value },
    });
    if (!text && value) landed.push(value);
    for (const t of arrowTargets(editor, c.id))
      if (isCard(t) && t.props.status === "done") editor.updateShape({ id: t.id, type: "gen-card", props: { status: "stale" } });
  }
  return landed;
}

// ───────────────────────── creating a card ─────────────────────────

const GAP = 48;

/**
 * Where a new card goes: right of its references when they are on the canvas, else under the
 * latest card (cards stack in a column and grow to the right with their variants), else in view.
 * Pushed down past whatever is already there.
 */
function freeSpot(editor: Editor, w: number, h: number, refs: { maxX: number; minY: number } | undefined) {
  const vp = editor.getViewportPageBounds();
  const last = editor.getCurrentPageShapesSorted().filter(isCard).at(-1);
  const lastBox = last ? editor.getShapePageBounds(last) : undefined;
  let x = refs ? refs.maxX + GAP : lastBox ? lastBox.minX : vp.center.x - w / 2;
  let y = refs ? refs.minY : lastBox ? lastBox.maxY + GAP : vp.center.y - h / 2 - 60;
  const boxes = editor
    .getCurrentPageShapes()
    .filter((s) => s.type !== "arrow")
    .map((s) => editor.getShapePageBounds(s))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));
  for (let i = 0; i < 60; i++) {
    const hit = boxes.find((b) => x < b.maxX + 24 && x + w > b.minX - 24 && y < b.maxY + 24 && y + h > b.minY - 24);
    if (!hit) break;
    y = hit.maxY + GAP;
  }
  return { x, y };
}

export type CardInput = {
  kind: string; // "image" | "capture-ios" | "capture-web"
  prompt: string;
  provider: string;
  model: string;
  meta: CardMeta;
};

/** Creates a card (see freeSpot), selects it, brings it into view and starts it. */
export function createCard(editor: Editor, input: CardInput, size: { w: number; h: number }) {
  const refShapes = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "media-ref" && (input.meta.refs ?? []).includes((s.props as { assetId: string }).assetId));
  const refBounds = refShapes.map((s) => editor.getShapePageBounds(s)!).filter(Boolean);
  const refBox = refBounds.length ? { maxX: Math.max(...refBounds.map((b) => b.maxX)), minY: Math.min(...refBounds.map((b) => b.minY)) } : undefined;
  const { x, y } = freeSpot(editor, size.w, size.h, refBox);
  const id = createShapeId();
  editor.run(() => {
    editor.createShape({
      id,
      type: "gen-card",
      x,
      y,
      props: { ...size, kind: input.kind, prompt: input.prompt, provider: input.provider, model: input.model, status: "idle", jobId: "", assetId: "", versions: [], chosen: 0, error: "" },
      meta: JSON.parse(JSON.stringify(input.meta)), // tldraw only takes JSON values (no undefined)
    });
    editor.select(id);
  });
  const vp = editor.getViewportPageBounds();
  if (!(x >= vp.minX && y >= vp.minY && x + size.w <= vp.maxX && y + size.h <= vp.maxY - 120))
    editor.centerOnPoint({ x: x + size.w / 2, y: y + size.h / 2 + 60 }, { animation: { duration: 240 } });
  void runCard(editor, id);
  return id;
}

/** Places a file of the project on the canvas as a reference, centred on `at`. */
export function placeRef(editor: Editor, f: { assetId: string; name: string; width?: number; height?: number; kind: string }, at: { x: number; y: number }) {
  const ratio = f.width && f.height ? f.width / f.height : f.kind === "audio" ? 1 : 9 / 16;
  const w = ratio >= 1 ? 200 : 110;
  const h = Math.round(w / ratio) + REF_LABEL;
  const id = createShapeId();
  editor.run(() => {
    editor.createShape({ id, type: "media-ref", x: at.x - w / 2, y: at.y - h / 2, props: { w, h, assetId: f.assetId, name: f.name }, meta: { assetId: f.assetId } });
  });
  return id;
}

export const REF_LABEL = 20;
