import type { ClaudeEvent, Montage, ServerEvent, ServerState, Version } from "@cezane/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { activeProject, get, post, scopedPath, subscribe } from "./api";
import { useProjects, type View } from "./projects";

export type { View } from "./projects";
export type Tool = "select" | "comment";
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
  reveal?: string; // Médias: show this asset's file (its folder opens), then cleared
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

/** What belongs to the reel on screen: forgotten when the tab or the reel changes. */
const perReel = { versionId: undefined, compare: false, compareId: undefined, commentId: undefined, selection: undefined, tool: "select" } as const;

/**
 * The live state of the active tab's project (only that one streams its full state; the tabs and
 * the home tab use the light /api/projects stream). Each project's last state is kept, so switching
 * tabs shows it at once while the stream reconnects.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const { active: pid, tabs, patchTab } = useProjects();
  const tab = tabs.find((t) => t.id === pid);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const cache = useRef(new Map<string, ServerState>());
  const [state, setState] = useState<ServerState | null>(() => (pid ? (cache.current.get(pid) ?? null) : null));
  const [log, setLog] = useState<ClaudeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [ui, setUiState] = useState<UI>({ view: tab?.view ?? "timeline", compare: false, tool: "select", panel: "comments", selection: undefined });
  const canvasListeners = useRef(new Set<(e: Extract<ServerEvent, { type: "canvas" }>) => void>());

  // Another tab: its cached state at once, its view, nothing selected.
  const [shown, setShown] = useState({ pid, reel: state?.montage.id });
  if (shown.pid !== pid) {
    const cached = pid ? (cache.current.get(pid) ?? null) : null;
    setShown({ pid, reel: cached?.montage.id });
    setState(cached);
    setLog([]);
    setError(undefined);
    setUiState((u) => ({ ...u, ...perReel, view: tab?.view ?? "timeline" }));
  } else if (state && shown.reel !== state.montage.id) {
    // Another reel of the same project.
    setShown({ pid, reel: state.montage.id });
    if (shown.reel) setUiState((u) => ({ ...u, ...perReel }));
  }

  useEffect(() => {
    if (!pid) return;
    let alive = true;
    // The reel this tab remembers (or was just opened on), checked against the first fresh state.
    let want = tabRef.current?.reel;
    const accept = (s: ServerState) => {
      if (!alive || s.projectId !== pid) return;
      cache.current.set(pid, s);
      setState(s);
      if (want && want !== s.montage.id && s.project.montages.some((m) => m.id === want)) {
        // The server has another reel selected (changed elsewhere): select the tab's one again, once.
        void post(scopedPath(`/api/reels/${encodeURIComponent(want)}/select`, pid)).catch(() => {});
        want = undefined;
        return;
      }
      want = undefined;
      patchTab(pid, { reel: s.montage.id }); // only fresh states: the tab follows the server's selection
    };
    const load = () =>
      Promise.all([get<ServerState>(scopedPath("/api/state", pid)), get<ClaudeEvent[]>(scopedPath("/api/claude/log", pid))])
        .then(([s, l]) => {
          if (!alive) return;
          accept(s);
          setLog(l ?? []);
          setError(undefined);
        })
        .catch((e) => alive && setError(String(e.message ?? e)));
    load();
    const off = subscribe(
      (e) => {
        if (!alive) return;
        if (e.type === "state") accept(e.state);
        else if (e.type === "claude") setLog((l) => (l.some((x) => x.id === e.event.id) ? l : [...l.slice(-499), e.event]));
        else if (e.type === "canvas") canvasListeners.current.forEach((fn) => fn(e));
      },
      (ok) => {
        setConnected(ok);
        if (ok) load();
      },
      pid,
    );
    return () => {
      alive = false;
      off();
    };
  }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps

  // The tab remembers its view (its reel: in accept, from fresh states only).
  useEffect(() => {
    if (pid) patchTab(pid, { view: ui.view });
  }, [pid, ui.view, patchTab]);

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
  const project = activeProject();
  useEffect(() => {
    if (!version) return setM(undefined);
    // Version ids are per project: the key carries the project.
    const key = `${project ?? ""}/${version.id}@${version.revision}`;
    let p = montageCache.get(key);
    if (!p) {
      p = get<Montage>(scopedPath(`/api/versions/${version.id}/montage`, project));
      montageCache.set(key, p);
      p.catch(() => montageCache.delete(key));
    }
    let alive = true;
    p.then((x) => alive && setM(x)).catch(() => alive && setM(undefined));
    return () => {
      alive = false;
    };
  }, [project, version?.id, version?.revision]);
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
