import type { GenerateRequest, Job, ModelInfo } from "@cezane/core";
import { createShapeId, type Editor, type TLAssetId, type TLShape, type TLShapeId } from "tldraw";
import { post } from "../api";
import { toast } from "../ui/toast";
import type { GenCardShape, GenKind } from "./GenCardShape";

export const CARD_SIZE: Record<GenKind, { w: number; h: number }> = {
  image: { w: 300, h: 380 },
  video: { w: 320, h: 400 },
  text: { w: 320, h: 320 },
  audio: { w: 300, h: 210 },
};

/** Set by CanvasView: the open canvas and the model registry. */
export const genContext: { canvasId?: string; models: ModelInfo[] } = { models: [] };

const isCard = (s: TLShape | undefined): s is GenCardShape => s?.type === "gen-card";

/** Cezane asset id behind a canvas shape (image/video shapes keep it in their tldraw asset meta). */
export function shapeAssetId(editor: Editor, s: TLShape): string | undefined {
  if (isCard(s)) return s.props.kind !== "text" && s.props.assetId ? s.props.assetId : undefined;
  if (s.type === "image" || s.type === "video") {
    const tlAssetId = (s.props as { assetId?: string | null }).assetId;
    const a = tlAssetId ? editor.getAsset(tlAssetId as TLAssetId) : undefined;
    return (a?.meta?.assetId as string | undefined) ?? (s.meta?.assetId as string | undefined);
  }
  return undefined;
}

export function shapeText(editor: Editor, s: TLShape): string | undefined {
  if (isCard(s)) return s.props.kind === "text" ? s.props.versions[s.props.chosen] : undefined;
  if (s.type === "text" || s.type === "note" || s.type === "geo") return editor.getShapeUtil(s).getText(s)?.trim() || undefined;
  return undefined;
}

/** Shapes at the start of arrows pointing to `id`. */
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

export function inputsOf(editor: Editor, shapes: TLShape[]) {
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

/** Starts a generation for a card from its prompt and the shapes wired into it. */
export async function runCard(editor: Editor, id: TLShapeId) {
  const card = editor.getShape(id);
  if (!isCard(card)) return;
  const p = card.props;
  const model = genContext.models.find((m) => m.provider === p.provider && m.id === p.model);
  if (model && !model.available) {
    toast(`${model.label} indisponible${model.note ? ` : ${model.note}` : ""}`);
    return;
  }
  const { assetIds, texts } = inputsOf(editor, arrowSources(editor, id));
  const prompt = texts.length ? `${texts.join("\n\n")}\n\n${p.prompt}` : p.prompt;
  let confirmCostEur: number | undefined;
  if (model && model.costEur > 0) {
    if (!confirm(`Cette génération coûte environ ${model.costEur.toFixed(2)} € (${model.label}). Continuer ?`)) return;
    confirmCostEur = model.costEur;
  }
  const req: GenerateRequest = { provider: p.provider, model: p.model, kind: p.kind as GenKind, prompt, inputs: assetIds, canvasId: genContext.canvasId, shapeId: id, confirmCostEur };
  editor.updateShape({ id, type: "gen-card", props: { status: "running", error: "" } });
  try {
    const job = await post<Job>("/api/generate", req);
    editor.updateShape({ id, type: "gen-card", props: { jobId: job.id } });
  } catch (e) {
    editor.updateShape({ id, type: "gen-card", props: { status: "error", error: (e as Error).message } });
  }
}

/** Applies finished jobs to their cards; cards fed by a changed card become "à régénérer". */
export function applyJobs(editor: Editor, jobs: Job[]) {
  const cards = editor.getCurrentPageShapes().filter(isCard).filter((c) => c.props.status === "running" && c.props.jobId);
  for (const c of cards) {
    const job = jobs.find((j) => j.id === c.props.jobId);
    if (!job || job.status === "running" || job.status === "queued") continue;
    if (job.status === "error") {
      editor.updateShape({ id: c.id, type: "gen-card", props: { status: "error", error: job.error ?? "Échec", jobId: "" } });
      continue;
    }
    const value = c.props.kind === "text" ? String(job.result?.text ?? "") : String(job.result?.assetId ?? "");
    const versions = [...c.props.versions, value];
    editor.updateShape({
      id: c.id,
      type: "gen-card",
      props: { status: "done", jobId: "", versions, chosen: versions.length - 1, assetId: c.props.kind === "text" ? "" : value },
    });
    for (const t of arrowTargets(editor, c.id))
      if (isCard(t) && t.props.status === "done") editor.updateShape({ id: t.id, type: "gen-card", props: { status: "stale" } });
  }
}

/** Runs the given cards one after the other, upstream first. */
export async function runInOrder(editor: Editor, ids: TLShapeId[]) {
  const pending = new Set(ids);
  const order: TLShapeId[] = [];
  const visit = (id: TLShapeId, seen = new Set<TLShapeId>()) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const s of arrowSources(editor, id)) if (pending.has(s.id)) visit(s.id, seen);
    if (!order.includes(id)) order.push(id);
  };
  ids.forEach((id) => visit(id));
  for (const id of order) {
    await runCard(editor, id);
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        const s = editor.getShape(id);
        if (!isCard(s) || s.props.status !== "running") {
          clearInterval(t);
          resolve();
        }
      }, 400);
    });
  }
}

/** Creates a card next to the given shapes, wired to them with arrows, and starts it. */
export function createCard(editor: Editor, inputs: TLShape[], opts: { kind: GenKind; prompt: string; model: ModelInfo }) {
  const size = CARD_SIZE[opts.kind];
  const bounds = inputs.length ? editor.getSelectionPageBounds() : undefined;
  const vp = editor.getViewportPageBounds();
  const x = bounds ? bounds.maxX + 120 : vp.center.x - size.w / 2;
  const y = bounds ? bounds.center.y - size.h / 2 : vp.center.y - size.h / 2 - 60;
  const id = createShapeId();
  editor.run(() => {
    editor.createShape({
      id,
      type: "gen-card",
      x,
      y,
      props: { ...size, kind: opts.kind, prompt: opts.prompt, provider: opts.model.provider, model: opts.model.id, status: "idle", jobId: "", assetId: "", versions: [], chosen: 0, error: "" },
    });
    for (const s of inputs) {
      const arrowId = createShapeId();
      const from = editor.getShapePageBounds(s)!.center;
      editor.createShape({ id: arrowId, type: "arrow", x: from.x, y: from.y, props: { start: { x: 0, y: 0 }, end: { x: x - from.x, y: y + size.h / 2 - from.y } } });
      const props = (terminal: "start" | "end") => ({ terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: "none" as const });
      editor.createBindings([
        { type: "arrow", fromId: arrowId, toId: s.id, props: props("start") },
        { type: "arrow", fromId: arrowId, toId: id, props: props("end") },
      ]);
    }
    editor.select(id);
  });
  void runCard(editor, id);
  return id;
}
