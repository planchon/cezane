import type { CanvasDoc, ModelInfo } from "@cezane/core";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Editor, getSnapshot, type TLComponents, Tldraw, useValue } from "tldraw";
import { api, get, isMock, post, uploadFiles } from "../api";
import { useApp } from "../store";
import { toast } from "../ui/toast";
import { Composer } from "./Composer";
import { FILE_MIME, type FileDrag, useMedias } from "./context";
import { reveal } from "./files";
import { applyJobs, genContext, isCard, placeRef, shapeAssetId } from "./generation";
import { GenCardUtil, MediaRefUtil } from "./shapes";

const shapeUtils = [GenCardUtil, MediaRefUtil];

// The composer holds the tools: none of tldraw's own panels (its shortcuts and context menu stay).
const components: TLComponents = {
  Toolbar: null,
  StylePanel: null,
  PageMenu: null,
  MainMenu: null,
  NavigationPanel: null,
  HelpMenu: null,
  ZoomMenu: null,
  Minimap: null,
  ActionsMenu: null,
  QuickActions: null,
  HelperButtons: null,
  DebugPanel: null,
  DebugMenu: null,
  SharePanel: null,
  MenuPanel: null,
  TopPanel: null,
  ImageToolbar: null,
  VideoToolbar: null,
};

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

/** Centre of the Médias view: the project's generation canvas (tldraw), its composer and the "saved" toast. */
export function GenCanvas() {
  const { state, onCanvasEvent } = useApp();
  const m = useMedias();
  const [doc, setDoc] = useState<CanvasDoc>();
  const [editor, setEditor] = useState<Editor>();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [over, setOver] = useState(false);
  const latest = useRef(m);
  latest.current = m;

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
      .then((x) => {
        genContext.models = x;
        if (alive) setModels(x);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    genContext.canvasId = doc?.id;
  }, [doc?.id]);

  useEffect(() => {
    m.setEditor(editor);
    return () => m.setEditor(undefined);
  }, [editor, m.setEditor]);

  // Persist user changes (debounced) and apply remote ones (Claude acting on the canvas).
  useEffect(() => {
    if (!editor || !doc) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const save = () => api("PUT", `/api/canvas/${doc.id}`, { snapshot: getSnapshot(editor.store) }).catch((e) => toast(`Sauvegarde du canvas : ${e.message}`));
    const off = editor.store.listen(
      () => {
        clearTimeout(t);
        t = setTimeout(save, 700);
      },
      { scope: "document", source: "user" },
    );
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

  // Finished jobs land in their cards; their files are announced once the listing has them.
  useEffect(() => {
    if (!editor || !state) return;
    const landed = applyJobs(editor, state.jobs);
    if (landed.length) latest.current.announce(landed);
  }, [editor, state?.jobs]);

  // The right panel follows the canvas selection: a reference, or a card's chosen variant.
  const selectedAsset = useValue(
    "selectedAsset",
    () => {
      if (!editor) return undefined;
      const sel = editor.getSelectedShapes();
      if (sel.length !== 1) return undefined;
      const s = sel[0]!;
      return s.type === "media-ref" || isCard(s) ? shapeAssetId(editor, s) : undefined;
    },
    [editor],
  );
  useEffect(() => {
    if (selectedAsset) latest.current.selectAsset(selectedAsset);
  }, [selectedAsset]);

  // Files dropped from the Finder: imported into Rushes/, placed on the canvas and used as references.
  useEffect(() => {
    if (!editor) return;
    editor.registerExternalContentHandler("files", async ({ files, point }) => {
      const at = point ?? editor.getViewportPageBounds().center;
      const media = files.filter((f) => /^(image|video)\//.test(f.type));
      if (!media.length) {
        toast("Glisse une image ou une vidéo sur le canvas.");
        return;
      }
      try {
        const assets = await uploadFiles(media);
        assets.forEach((a, i) => placeRef(editor, { assetId: a.id, name: a.name, width: a.width, height: a.height, kind: a.kind }, { x: at.x + i * 130, y: at.y }));
        latest.current.addRefs(assets.map((a) => a.id));
        toast(`${assets.length} fichier${assets.length > 1 ? "s" : ""} importé${assets.length > 1 ? "s" : ""} dans Rushes`);
      } catch (e) {
        toast(`Import : ${(e as Error).message}`);
      }
    });
    return () => void editor.registerExternalContentHandler("files", null);
  }, [editor]);

  // A file dragged from the viewer becomes a reference on the canvas.
  const onDrop = (e: React.DragEvent) => {
    setOver(false);
    if (!editor || !e.dataTransfer.types.includes(FILE_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    const d = JSON.parse(e.dataTransfer.getData(FILE_MIME)) as FileDrag;
    const f = m.byPath.get(d.path);
    if (!f?.assetId) {
      toast("Ce fichier n'est pas encore importé : il ne peut pas servir de référence.");
      return;
    }
    placeRef(editor, { assetId: f.assetId, name: f.name, width: f.width, height: f.height, kind: f.kind }, editor.screenToPage({ x: e.clientX, y: e.clientY }));
    m.addRefs([f.assetId]);
  };

  if (!doc) return <div className="cv canvas-wrap md-canvas" />;

  // A canvas only touched by the server (Claude's `canvas` tool) has records but no tldraw schema:
  // start from an empty editor and insert its shapes instead of loading it as a snapshot.
  const snap = doc.snapshot as { document?: { schema?: { schemaVersion?: number }; store?: Record<string, PartialRecord> } } | undefined;
  const loadable = Boolean(snap?.document?.schema?.schemaVersion);
  const toCreate = [...(loadable ? [] : Object.values(snap?.document?.store ?? {}).filter((r) => r.typeName === "shape")), ...((doc.pending ?? []) as PartialRecord[])];

  return (
    <div
      className={`cv canvas-wrap md-canvas ${over ? "drop" : ""}`}
      onDragOverCapture={(e) => {
        if (!e.dataTransfer.types.includes(FILE_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDropCapture={onDrop}
    >
      <Tldraw
        snapshot={loadable ? (doc.snapshot as never) : undefined}
        shapeUtils={shapeUtils}
        components={components}
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
      {editor && <Composer editor={editor} models={models} />}
      <SavedToast />
    </div>
  );
}

/** "Enregistré dans Générés/fond-studio-01.png · Afficher dans le Finder" (dark, top right of the canvas). */
function SavedToast() {
  const { saved, dismissSaved, select } = useMedias();
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(dismissSaved, 7000);
    return () => clearTimeout(t);
  }, [saved, dismissSaved]);
  if (!saved) return null;
  return (
    <div className="md-toast" role="status">
      <Check size={16} />
      <span className="ell">
        Enregistré dans{" "}
        <button className="md-link" onClick={() => select(saved.path)}>
          {saved.path}
        </button>
      </span>
      <button className="btn" onClick={() => void reveal({ path: saved.path })}>
        Afficher dans le Finder
      </button>
    </div>
  );
}
