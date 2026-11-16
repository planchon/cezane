import type { Asset, CanvasDoc, Comment, ModelInfo, Workflow } from "@cezane/core";
import { BookMarked, MessageCirclePlus, Play, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssetRecordType,
  type Editor,
  getSnapshot,
  type TLAssetStore,
  type TLContent,
  type TLShape,
  type TLShapeId,
  Tldraw,
  useValue,
} from "tldraw";
import { api, assetMedia, get, isMock, post, uploadFiles } from "../api";
import { useApp } from "../store";
import { ASSET_MIME } from "../ui/AssetsPanel";
import { attempt, toast } from "../ui/toast";
import { GenCardUtil, type GenKind } from "./GenCardShape";
import { applyJobs, createCard, genContext, inputsOf, runInOrder } from "./generation";

const shapeUtils = [GenCardUtil];
const hiddenUi = { MainMenu: null, PageMenu: null, HelpMenu: null, DebugPanel: null, DebugMenu: null, SharePanel: null };

/** Images/videos dropped on the canvas are uploaded to the project and become assets. */
const assetStore: TLAssetStore = {
  async upload(_asset, file) {
    const [a] = await uploadFiles([file]);
    if (!a) throw new Error("upload failed");
    return { src: assetMedia(a), meta: { assetId: a.id } };
  },
};

export function CanvasView() {
  const { state, onCanvasEvent } = useApp();
  const [doc, setDoc] = useState<CanvasDoc>();
  const [editor, setEditor] = useState<Editor>();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [commenting, setCommenting] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Open the first canvas of the project (create one if needed).
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await get<{ id: string; name: string }[]>("/api/canvases");
      const ref = list[0] ?? (await post<CanvasDoc>("/api/canvases", { name: "Canvas" }));
      const d = await get<CanvasDoc>(`/api/canvas/${ref.id}`);
      if (alive) setDoc(d);
    })().catch((e) => toast(`Canvas : ${e.message}`));
    get<ModelInfo[]>("/api/models")
      .then((m) => {
        genContext.models = m;
        setModels(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    genContext.canvasId = doc?.id;
  }, [doc?.id]);

  // Persist user changes (debounced) and apply remote ones (Claude acting on the canvas).
  useEffect(() => {
    if (!editor || !doc) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const save = () => api("PUT", `/api/canvas/${doc.id}`, { snapshot: getSnapshot(editor.store) }).catch((e) => toast(`Sauvegarde du canvas : ${e.message}`));
    const off = editor.store.listen(() => {
      clearTimeout(t);
      t = setTimeout(save, 700);
    }, { scope: "document", source: "user" });
    const offRemote = onCanvasEvent((e) => {
      if (e.canvasId !== doc.id) return;
      if (e.put.length) materialize(editor, e.put as PartialRecord[]);
      if (e.remove.length) editor.store.mergeRemoteChanges(() => editor.store.remove(e.remove as never[]));
    });
    const flush = () => {
      if (t) {
        clearTimeout(t);
        void save();
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      off();
      offRemote();
      window.removeEventListener("beforeunload", flush);
    };
  }, [editor, doc, onCanvasEvent]);

  // Finished generation jobs land in their cards.
  useEffect(() => {
    if (editor && state) applyJobs(editor, state.jobs);
  }, [editor, state?.jobs]);

  const onDropAsset = (e: React.DragEvent) => {
    if (!editor || !e.dataTransfer.types.includes(ASSET_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    const { id } = JSON.parse(e.dataTransfer.getData(ASSET_MIME)) as { id: string };
    const a = state?.project.assets.find((x) => x.id === id);
    if (a) placeAsset(editor, a, editor.screenToPage({ x: e.clientX, y: e.clientY }));
  };

  if (!doc) return <div className="canvas-wrap panel" />;

  // A canvas only touched by the server (Claude's `canvas` tool) has records but no tldraw schema:
  // start from an empty editor and insert its shapes instead of loading it as a snapshot.
  const snap = doc.snapshot as { document?: { schema?: { schemaVersion?: number }; store?: Record<string, PartialRecord> } } | undefined;
  const loadable = Boolean(snap?.document?.schema?.schemaVersion);
  const toCreate = [...(loadable ? [] : Object.values(snap?.document?.store ?? {}).filter((r) => r.typeName === "shape")), ...((doc.pending ?? []) as PartialRecord[])];

  return (
    <div
      className="canvas-wrap"
      ref={wrap}
      onDragOverCapture={(e) => {
        if (e.dataTransfer.types.includes(ASSET_MIME)) e.preventDefault();
      }}
      onDropCapture={onDropAsset}
    >
      <Tldraw
        snapshot={loadable ? (doc.snapshot as never) : undefined}
        shapeUtils={shapeUtils}
        assets={assetStore}
        components={hiddenUi}
        onMount={(ed) => {
          ed.user.updateUserPreferences({ colorScheme: "light" });
          if (isMock) (window as unknown as { __editor: Editor }).__editor = ed;
          if (toCreate.length) {
            materialize(ed, toCreate);
            ed.selectNone();
            ed.zoomToFit({ animation: { duration: 0 } });
            void api("PUT", `/api/canvas/${doc.id}`, { snapshot: getSnapshot(ed.store) }).catch(() => {});
          }
          setEditor(ed);
        }}
      />
      {editor && (
        <>
          <CanvasTop editor={editor} commenting={commenting} setCommenting={setCommenting} libOpen={libOpen} setLibOpen={setLibOpen} />
          <PromptBar editor={editor} models={models} />
          <CanvasComments editor={editor} canvasId={doc.id} commenting={commenting} setCommenting={setCommenting} wrap={wrap} />
        </>
      )}
    </div>
  );
}

function placeAsset(editor: Editor, a: Asset, at: { x: number; y: number }) {
  if (a.kind === "audio") {
    toast("Glisse une image ou une vidéo sur le canvas.");
    return;
  }
  const w0 = a.width ?? 1080;
  const h0 = a.height ?? 1080;
  const scale = Math.min(1, 320 / Math.max(w0, h0));
  const w = w0 * scale;
  const h = h0 * scale;
  const tlAsset = AssetRecordType.create({
    id: AssetRecordType.createId(),
    type: a.kind,
    props: { name: a.name, src: assetMedia(a), w: w0, h: h0, mimeType: a.kind === "video" ? "video/mp4" : "image/png", isAnimated: a.kind === "video" },
    meta: { assetId: a.id },
  } as never);
  editor.run(() => {
    editor.createAssets([tlAsset]);
    editor.createShape({ type: a.kind, x: at.x - w / 2, y: at.y - h / 2, props: { assetId: tlAsset.id, w, h }, meta: { assetId: a.id } } as never);
  });
}

// ───────────────────────── top-right actions: workflows, comment tool ─────────────────────────

function CanvasTop({ editor, commenting, setCommenting, libOpen, setLibOpen }: { editor: Editor; commenting: boolean; setCommenting: (b: boolean) => void; libOpen: boolean; setLibOpen: (b: boolean) => void }) {
  const selected = useValue("sel", () => editor.getSelectedShapes(), [editor]);
  const stale = useValue("stale", () => editor.getCurrentPageShapes().filter((s) => s.type === "gen-card" && s.props.status === "stale").map((s) => s.id), [editor]);
  const selectedCards = selected.filter((s) => s.type === "gen-card").map((s) => s.id);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  const saveWorkflow = async () => {
    const name = prompt("Nom du workflow ?", "Mon workflow");
    if (!name) return;
    const content = editor.getContentFromCurrentPage(selected.map((s) => s.id));
    if (!content) return;
    await attempt(() => post("/api/workflows", { name, shapes: content.shapes, bindings: content.bindings ?? [], assets: content.assets, rootShapeIds: content.rootShapeIds, schema: content.schema }), `Workflow « ${name} » enregistré`);
  };

  const insert = (w: Workflow & Partial<TLContent>) => {
    const shapes = (w.shapes as TLShape[]).map((s) =>
      s.type === "gen-card" ? { ...s, props: { ...s.props, status: "idle", jobId: "", versions: [], chosen: 0, assetId: "", error: "" } } : s,
    );
    const ids = new Set(shapes.map((s) => s.id));
    const content: TLContent = {
      shapes,
      bindings: (w.bindings ?? []) as TLContent["bindings"],
      assets: w.assets ?? [],
      rootShapeIds: w.rootShapeIds ?? shapes.filter((s) => !ids.has(s.parentId as TLShapeId)).map((s) => s.id),
      schema: w.schema ?? editor.store.schema.serialize(),
    };
    editor.putContentOntoCurrentPage(content, { point: editor.getViewportPageBounds().center, select: true });
    setLibOpen(false);
    toast(`« ${w.name} » inséré : branche tes entrées puis lance.`);
  };

  return (
    <>
      <div className="canvas-top">
        {selectedCards.length > 0 && (
          <button className="btn sm" onClick={() => runInOrder(editor, selectedCards)}>
            <Play size={13} /> Lancer ({selectedCards.length})
          </button>
        )}
        {stale.length > 0 && (
          <button className="btn sm" style={{ borderColor: "var(--ochre)" }} onClick={() => runInOrder(editor, stale)}>
            <Sparkles size={13} /> Tout relancer ({stale.length})
          </button>
        )}
        {selected.length > 1 && (
          <button className="btn sm" onClick={saveWorkflow}>
            <Save size={13} /> Enregistrer comme workflow
          </button>
        )}
        <button
          className={`btn sm ${libOpen ? "primary" : ""}`}
          onClick={() => {
            if (!libOpen) get<Workflow[]>("/api/workflows").then(setWorkflows).catch(() => setWorkflows([]));
            setLibOpen(!libOpen);
          }}
        >
          <BookMarked size={13} /> Bibliothèque
        </button>
        <button className={`btn sm ${commenting ? "accent" : ""}`} onClick={() => setCommenting(!commenting)} title="Commenter un élément : une demande pour Claude">
          <MessageCirclePlus size={13} /> Commenter
        </button>
      </div>
      {libOpen && (
        <div className="menu lib scroll">
          {!workflows.length && <div className="empty">Aucun workflow. Sélectionne des cartes reliées puis « Enregistrer comme workflow ».</div>}
          {workflows.map((w) => (
            <button key={w.id} className="menu-item" onClick={() => insert(w as Workflow & Partial<TLContent>)}>
              <BookMarked size={15} />
              <div>
                <div style={{ fontWeight: 600 }}>{w.name}</div>
                <small>{(w.shapes as TLShape[]).filter((s) => s.type === "gen-card").length} carte(s) · {new Date(w.createdAt).toLocaleDateString("fr-FR")}</small>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ───────────────────────── prompt bar ─────────────────────────

const kinds: { id: GenKind; label: string }[] = [
  { id: "image", label: "Image" },
  { id: "video", label: "Vidéo" },
  { id: "text", label: "Texte" },
  { id: "audio", label: "Audio" },
];

function PromptBar({ editor, models }: { editor: Editor; models: ModelInfo[] }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<GenKind>("image");
  const [modelKey, setModelKey] = useState("");
  const selected = useValue("sel", () => editor.getSelectedShapes(), [editor]);
  const editing = useValue("editing", () => editor.getEditingShapeId(), [editor]);
  const usable = selected.filter((s) => ["image", "video", "text", "note", "gen-card", "geo"].includes(s.type));
  const { assetIds, texts } = useMemo(() => inputsOf(editor, usable), [editor, usable]);
  const forKind = models.filter((m) => m.kind === kind);
  const model = forKind.find((m) => `${m.provider}/${m.id}` === modelKey) ?? forKind.find((m) => m.available) ?? forKind[0];

  // Hidden while editing a shape, or when the selection has nothing that can feed a generation.
  if (editing || (selected.length > 0 && usable.length === 0)) return null;

  const submit = () => {
    if (!text.trim() || !model) return;
    if (!model.available) {
      toast(`${model.label} indisponible${model.note ? ` : ${model.note}` : ""}`);
      return;
    }
    createCard(editor, usable, { kind, prompt: text.trim(), model });
    setText("");
  };

  return (
    <div className="promptbar" onPointerDown={(e) => e.stopPropagation()}>
      {usable.length > 0 && (
        <div className="ctx">
          <Sparkles size={12} />
          Entrées :{assetIds.length ? ` ${assetIds.length} média${assetIds.length > 1 ? "s" : ""}` : ""}
          {texts.length ? ` ${texts.length} texte${texts.length > 1 ? "s" : ""}` : ""}
          {!assetIds.length && !texts.length ? " aucune (sélection sans contenu)" : ""}
        </div>
      )}
      <div className="row">
        <input
          className="field"
          placeholder={usable.length ? "Décris la modification ou le résultat…" : "Décris l'image, la vidéo ou le texte à générer…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") submit();
          }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as GenKind)}>
          {kinds.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <select value={model ? `${model.provider}/${model.id}` : ""} onChange={(e) => setModelKey(e.target.value)} style={{ maxWidth: 270 }}>
          {!forKind.length && <option value="">Aucun modèle</option>}
          {forKind.map((m) => (
            <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`} disabled={!m.available}>
              {m.label} — {m.costEur > 0 ? `~${m.costEur.toFixed(2)} €` : "abonnement"}
              {!m.available ? " (indisponible)" : ""}
            </option>
          ))}
        </select>
        <button className="btn accent" disabled={!text.trim() || !model?.available} onClick={submit}>
          Générer ⏎
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── comments on canvas elements ─────────────────────────

function CanvasComments({ editor, canvasId, commenting, setCommenting, wrap }: { editor: Editor; canvasId: string; commenting: boolean; setCommenting: (b: boolean) => void; wrap: React.RefObject<HTMLDivElement | null> }) {
  const { state, ui, setUi } = useApp();
  const camera = useValue("camera", () => editor.getCamera(), [editor]);
  const [draft, setDraft] = useState<{ page: { x: number; y: number }; shapeId?: string; at: { x: number; y: number } }>();
  const [text, setText] = useState("");
  const comments = (state?.comments ?? []).filter((c): c is Comment & { anchor: { kind: "canvas" } } => c.anchor.kind === "canvas" && c.anchor.canvasId === canvasId);
  const origin = wrap.current?.getBoundingClientRect();
  void camera;

  const toLocal = (page: { x: number; y: number }) => {
    const s = editor.pageToScreen(page);
    return { x: s.x - (origin?.left ?? 0), y: s.y - (origin?.top ?? 0) };
  };

  const submit = async () => {
    if (!draft || !text.trim()) return;
    const c = await attempt(() => post<Comment>("/api/comments", { anchor: { kind: "canvas", canvasId, shapeId: draft.shapeId, pin: draft.page }, text: text.trim() }));
    if (c) setUi({ commentId: c.id, panel: "comments" });
    setDraft(undefined);
    setText("");
    setCommenting(false);
  };

  return (
    <>
      {commenting && (
        <div
          className="canvas-overlay"
          onPointerDown={(e) => {
            if (draft) return;
            const page = editor.screenToPage({ x: e.clientX, y: e.clientY });
            const shape = editor.getShapeAtPoint(page, { hitInside: true, margin: 4 });
            const r = wrap.current!.getBoundingClientRect();
            setDraft({ page: { x: page.x, y: page.y }, shapeId: shape?.id, at: { x: Math.min(r.width - 290, e.clientX - r.left + 12), y: Math.min(r.height - 180, e.clientY - r.top) } });
          }}
        />
      )}
      {comments.map((c) => {
        if (!c.anchor.pin) return null;
        const p = toLocal(c.anchor.pin);
        const cls = c.status === "in_progress" ? "sent" : c.status;
        return (
          <div key={c.id} className={`cpin ${cls}`} style={{ left: p.x, top: p.y, outline: ui.commentId === c.id ? "2px solid var(--ink)" : undefined }} onClick={() => setUi({ commentId: c.id, panel: "comments" })} title={c.thread[0]?.text}>
            <span>{c.n}</span>
          </div>
        );
      })}
      {draft && (
        <div className="composer" style={{ left: draft.at.x, top: draft.at.y, zIndex: 400 }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="where">
            <span className="chip apple">Nouveau</span>
            {draft.shapeId ? `Sur ${editor.getShape(draft.shapeId as TLShapeId)?.type ?? "l'élément"}` : "Sur le canvas"}
          </div>
          <textarea
            className="field"
            rows={3}
            autoFocus
            placeholder="Une demande pour Claude (ex. « rends sa veste rouge, même visage »)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") setDraft(undefined);
            }}
          />
          <div className="row">
            <button className="btn sm ghost" onClick={() => setDraft(undefined)}>
              Annuler
            </button>
            <button className="btn sm accent" disabled={!text.trim()} onClick={submit}>
              Ajouter
            </button>
          </div>
        </div>
      )}
    </>
  );
}

type PartialRecord = { id: string; typeName?: string; type?: string; x?: number; y?: number; props?: Record<string, unknown>; meta?: Record<string, unknown> };

/**
 * Shapes written by the server (Claude's `canvas` tool) are partial: create or update them
 * through the editor so tldraw fills the default props and validates them.
 */
function materialize(editor: Editor, records: PartialRecord[]) {
  for (const r of records) {
    if (r.typeName && r.typeName !== "shape") {
      editor.store.mergeRemoteChanges(() => editor.store.put([r as never]));
      continue;
    }
    try {
      const partial = { id: r.id, type: r.type, x: r.x ?? 0, y: r.y ?? 0, props: r.props ?? {}, meta: r.meta ?? {} };
      if (editor.getShape(r.id as never)) editor.updateShape(partial as never);
      else editor.createShape(partial as never);
    } catch (e) {
      console.error("canvas: cannot create shape", r.id, e);
    }
  }
}
