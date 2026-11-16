import type { FilesListing, FolderNode, ProjectFile } from "@cezane/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "tldraw";
import { get, subscribe } from "../api";
import { useApp } from "../store";

/** Drag payload of a file dragged out of the file viewer. */
export const FILE_MIME = "application/x-cezane-file";
export type FileDrag = { path: string; assetId?: string };

/** "missing:<assetId>": a file deleted from the Finder that a montage still uses. */
export const missingKey = (assetId: string) => `missing:${assetId}`;

type Saved = { path: string; at: number };

type Ctx = {
  listing?: FilesListing;
  error?: string;
  reload: () => void;
  files: ProjectFile[];
  byPath: Map<string, ProjectFile>;
  byAsset: Map<string, ProjectFile>;
  /** Folder shown in the viewer: "Générés", "Rushes/Jour 1"… */
  folder: string;
  setFolder: (path: string) => void;
  /** Selected file: its path, or missingKey(assetId). */
  selected?: string;
  select: (key: string | undefined) => void;
  /** Selects the file of an asset and opens its folder. */
  selectAsset: (assetId: string) => void;
  /** Reference assets for the next generation (composer chips). */
  refs: string[];
  addRefs: (ids: string[]) => void;
  removeRef: (id: string) => void;
  /** Assets that just landed: the toast shows their file once the listing has it. */
  announce: (assetIds: string[]) => void;
  saved?: Saved;
  dismissSaved: () => void;
  editor?: Editor;
  setEditor: (e: Editor | undefined) => void;
};

const MediasCtx = createContext<Ctx | null>(null);

export function useMedias(): Ctx {
  const c = useContext(MediasCtx);
  if (!c) throw new Error("useMedias outside MediasProvider");
  return c;
}

export function flatten(nodes: FolderNode[], out: ProjectFile[] = []): ProjectFile[] {
  for (const n of nodes) {
    out.push(...n.files);
    flatten(n.folders, out);
  }
  return out;
}

export function findNode(nodes: FolderNode[], path: string): FolderNode | undefined {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (path.startsWith(`${n.path}/`)) return findNode(n.folders, path);
  }
  return undefined;
}

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");

const stored = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {}
};

/** The Médias view state: the project's files (reloaded on `files` events), the selection, the composer references. */
export function MediasProvider({ children }: { children: ReactNode }) {
  const { state, ui, setUi } = useApp();
  const projectId = state?.projectId;
  const [listing, setListing] = useState<FilesListing>();
  const [error, setError] = useState<string>();
  const [folder, setFolderState] = useState(() => stored("cezane.medias.folder", "Générés"));
  const [selected, setSelected] = useState<string>();
  const [refs, setRefs] = useState<string[]>([]);
  const [saved, setSaved] = useState<Saved>();
  const [pending, setPending] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor>();

  // One load at a time; a change during a load triggers one more.
  const loading = useRef<{ busy: boolean; again: boolean; alive: boolean }>({ busy: false, again: false, alive: true });
  const reload = useCallback(() => {
    const l = loading.current;
    if (l.busy) {
      l.again = true;
      return;
    }
    l.busy = true;
    get<FilesListing>("/api/files")
      .then((x) => {
        if (!l.alive) return;
        setListing(x);
        setError(undefined);
      })
      .catch((e: Error) => l.alive && setError(e.message))
      .finally(() => {
        l.busy = false;
        if (l.again && l.alive) {
          l.again = false;
          reload();
        }
      });
  }, []);

  useEffect(() => {
    const l = loading.current;
    l.alive = true;
    setListing(undefined);
    setSelected(undefined);
    setRefs([]);
    reload();
    const off = subscribe((e) => {
      if (e.type === "files") reload();
    });
    return () => {
      l.alive = false;
      off();
    };
  }, [projectId, reload]);

  // An asset finishing its ingestion changes its thumbnail and metadata: refresh.
  const assetSig = state?.project.assets.map((a) => `${a.id}:${a.status}:${a.missing ? 1 : 0}`).join(",");
  const firstSig = useRef(true);
  useEffect(() => {
    if (firstSig.current) {
      firstSig.current = false;
      return;
    }
    const t = setTimeout(reload, 200);
    return () => clearTimeout(t);
  }, [assetSig, reload]);

  const files = useMemo(() => (listing ? flatten(listing.folders) : []), [listing]);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const byAsset = useMemo(() => new Map(files.filter((f) => f.assetId).map((f) => [f.assetId!, f])), [files]);

  const setFolder = useCallback((p: string) => {
    setFolderState(p);
    store("cezane.medias.folder", p);
  }, []);

  const selectAsset = useCallback(
    (assetId: string) => {
      const f = byAsset.get(assetId);
      const gone = listing?.missing.find((m) => m.assetId === assetId);
      if (f) {
        setSelected(f.path);
        setFolder(dirOf(f.path));
      } else if (gone) {
        setSelected(missingKey(assetId));
        setFolder(dirOf(gone.path));
      }
    },
    [byAsset, listing, setFolder],
  );

  // Another view asked to show a file here (a failed render: "Relier le fichier").
  useEffect(() => {
    if (!ui.reveal || !listing) return;
    selectAsset(ui.reveal);
    setUi({ reveal: undefined });
  }, [ui.reveal, listing, selectAsset, setUi]);

  // "Enregistré dans Générés/…" once the listing shows the new file.
  useEffect(() => {
    if (!pending.length) return;
    const ready = pending.filter((id) => byAsset.has(id));
    if (!ready.length) return;
    const last = byAsset.get(ready.at(-1)!)!;
    setSaved({ path: last.path, at: Date.now() });
    setPending((p) => p.filter((id) => !ready.includes(id)));
  }, [pending, byAsset]);

  const value: Ctx = {
    listing,
    error,
    reload,
    files,
    byPath,
    byAsset,
    folder,
    setFolder,
    selected,
    select: setSelected,
    selectAsset,
    refs,
    addRefs: useCallback((ids: string[]) => setRefs((r) => [...r, ...ids.filter((id) => !r.includes(id))]), []),
    removeRef: useCallback((id: string) => setRefs((r) => r.filter((x) => x !== id)), []),
    announce: useCallback((ids: string[]) => setPending((p) => [...p, ...ids]), []),
    saved,
    dismissSaved: useCallback(() => setSaved(undefined), []),
    editor,
    setEditor,
  };
  return <MediasCtx.Provider value={value}>{children}</MediasCtx.Provider>;
}
