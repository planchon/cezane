import type { ClaudeEvent, Montage, ServerEvent, ServerState, Version } from "@cezane/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { get, subscribe } from "./api";

export type Tool = "select" | "comment";
/** The work area's views, picked in the floating switcher. */
export type View = "timeline" | "medias" | "export";
export type Selection = { kind: "clip"; id: string } | { kind: "asset"; id: string } | undefined;

export type UI = {
  view: View;
  versionId?: string; // displayed version (default: latest ready)
  compare: boolean;
  compareId?: string; // B side
  tool: Tool;
  panel: "comments" | "claude" | "props";
  commentId?: string;
  selection: Selection;
};

type Ctx = {
  state: ServerState | null;
  log: ClaudeEvent[];
  connected: boolean;
  error?: string;
  ui: UI;
  setUi: (patch: Partial<UI> | ((u: UI) => Partial<UI>)) => void;
  version?: Version; // displayed version
  onCanvasEvent: (fn: (e: Extract<ServerEvent, { type: "canvas" }>) => void) => () => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState | null>(null);
  const [log, setLog] = useState<ClaudeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [ui, setUiState] = useState<UI>({ view: "timeline", compare: false, tool: "select", panel: "comments", selection: undefined });
  const canvasListeners = useRef(new Set<(e: Extract<ServerEvent, { type: "canvas" }>) => void>());

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([get<ServerState>("/api/state"), get<ClaudeEvent[]>("/api/claude/log")])
        .then(([s, l]) => {
          if (!alive) return;
          setState(s);
          setLog(l ?? []);
          setError(undefined);
        })
        .catch((e) => alive && setError(String(e.message ?? e)));
    load();
    const off = subscribe(
      (e) => {
        if (e.type === "state") setState(e.state);
        else if (e.type === "claude")
          setLog((l) => (l.some((x) => x.id === e.event.id) ? l : [...l.slice(-499), e.event]));
        else if (e.type === "canvas") canvasListeners.current.forEach((fn) => fn(e));
      },
      (ok) => {
        setConnected(ok);
        if (ok) load();
      },
    );
    return () => {
      alive = false;
      off();
    };
  }, []);

  const setUi = useCallback((patch: Partial<UI> | ((u: UI) => Partial<UI>)) => {
    setUiState((u) => ({ ...u, ...(typeof patch === "function" ? patch(u) : patch) }));
  }, []);

  const version = useMemo(() => {
    const vs = state?.versions ?? [];
    return vs.find((v) => v.id === ui.versionId) ?? [...vs].reverse().find((v) => v.status === "ready") ?? vs.at(-1);
  }, [state?.versions, ui.versionId]);

  const onCanvasEvent = useCallback((fn: (e: Extract<ServerEvent, { type: "canvas" }>) => void) => {
    canvasListeners.current.add(fn);
    return () => void canvasListeners.current.delete(fn);
  }, []);

  return <AppCtx.Provider value={{ state, log, connected, error, ui, setUi, version, onCanvasEvent }}>{children}</AppCtx.Provider>;
}

// ───────── frozen montage of a version (cached) ─────────

const montageCache = new Map<string, Promise<Montage>>();

export function useVersionMontage(version: Version | undefined, fallback: Montage | undefined): Montage | undefined {
  const [m, setM] = useState<Montage | undefined>();
  useEffect(() => {
    if (!version) return setM(undefined);
    const key = `${version.id}@${version.revision}`;
    let p = montageCache.get(key);
    if (!p) {
      p = get<Montage>(`/api/versions/${version.id}/montage`);
      montageCache.set(key, p);
      p.catch(() => montageCache.delete(key));
    }
    let alive = true;
    p.then((x) => alive && setM(x)).catch(() => alive && setM(undefined));
    return () => {
      alive = false;
    };
  }, [version?.id, version?.revision]);
  return version ? (m ?? fallback) : fallback;
}

// ───────── playhead: a tiny external store so the player can tick without re-rendering the app ─────────

type PlayerApi = { seek: (frame: number) => void; toggle: () => void; playing: () => boolean };

export const playhead = (() => {
  let frame = 0;
  let playing = false;
  const subs = new Set<() => void>();
  let api: PlayerApi | undefined;
  const notify = () => subs.forEach((s) => s());
  return {
    get: () => frame,
    isPlaying: () => playing,
    set(f: number, p = playing) {
      if (f === frame && p === playing) return;
      frame = f;
      playing = p;
      notify();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    register(a: PlayerApi | undefined) {
      api = a;
    },
    seek(f: number) {
      if (api) api.seek(f);
      else this.set(f);
    },
    toggle() {
      api?.toggle();
    },
  };
})();

export const useFrame = () => useSyncExternalStore(playhead.subscribe, playhead.get);
export const usePlaying = () => useSyncExternalStore(playhead.subscribe, playhead.isPlaying);
