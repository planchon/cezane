import type { ProjectSummary, SchedulerState } from "@cezane/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, get, post, setActiveProject, subscribeProjects } from "./api";

/** The work area's views, picked in the floating switcher (kept per tab). */
export type View = "timeline" | "canvas" | "medias" | "export";

/** One open project tab: its view and its reel are remembered. */
export type TabState = { id: string; view: View; reel?: string };

type Saved = { tabs: TabState[]; active: string | null };
const KEY = "cezane.tabs.v1";
const VIEWS = new Set<View>(["timeline", "canvas", "medias", "export"]);

function load(): Saved | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const s = JSON.parse(raw) as Partial<Saved>;
    const tabs = (Array.isArray(s.tabs) ? s.tabs : [])
      .filter((t): t is TabState => typeof t?.id === "string")
      .map((t) => ({ id: t.id, view: VIEWS.has(t.view) ? t.view : "timeline", reel: typeof t.reel === "string" ? t.reel : undefined }));
    const active = typeof s.active === "string" && tabs.some((t) => t.id === s.active) ? s.active : null;
    return { tabs, active };
  } catch {
    return undefined;
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

type Ctx = {
  /** Every known project (GET /api/projects/events); null until the first answer. */
  projects: ProjectSummary[] | null;
  connected: boolean;
  tabs: TabState[];
  /** The active tab's project id; null: the home tab. */
  active: string | null;
  /** Opens a project in a tab (or activates its tab), optionally on a reel and a view. */
  open: (id: string, o?: { reel?: string; view?: View }) => Promise<void>;
  /** Shows a tab (null: home). */
  activate: (id: string | null) => void;
  /** Closes a tab. The project itself is untouched (still on the home tab). */
  close: (id: string) => void;
  patchTab: (id: string, patch: Partial<Omit<TabState, "id">>) => void;
  createProject: (name: string) => Promise<ProjectSummary>;
  /** Opens a folder; `init` makes it a project when it has no cezane.json. */
  openFolder: (path: string, init?: boolean) => Promise<ProjectSummary>;
  summary: (id: string | null | undefined) => ProjectSummary | undefined;
};

const ProjectsCtx = createContext<Ctx | null>(null);

export function useProjects(): Ctx {
  const c = useContext(ProjectsCtx);
  if (!c) throw new Error("useProjects outside provider");
  return c;
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const saved = useRef(load());
  const [tabs, setTabs] = useState<TabState[]>(() => saved.current?.tabs ?? []);
  const [active, setActive] = useState<string | null>(() => {
    const a = saved.current?.active ?? null;
    setActiveProject(a ?? saved.current?.tabs[0]?.id); // before the first render of the work area
    return a;
  });
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(
    () =>
      subscribeProjects(
        (e) => setProjects(e.projects),
        (ok) => {
          setConnected(ok);
          if (ok) get<ProjectSummary[]>("/api/projects").then(setProjects, () => {});
        },
      ),
    [],
  );

  useEffect(() => save({ tabs, active }), [tabs, active]);

  const activate = useCallback((id: string | null) => {
    if (id) setActiveProject(id);
    setActive(id);
  }, []);

  const open = useCallback(
    async (id: string, o: { reel?: string; view?: View } = {}) => {
      // Select the reel first so the tab's live state starts on it.
      if (o.reel) await post(`/api/p/${encodeURIComponent(id)}/reels/${encodeURIComponent(o.reel)}/select`).catch(() => {});
      setTabs((ts) => {
        const patch = { ...(o.reel ? { reel: o.reel } : {}), ...(o.view ? { view: o.view } : {}) };
        return ts.some((t) => t.id === id) ? ts.map((t) => (t.id === id ? { ...t, ...patch } : t)) : [...ts, { id, view: "timeline", ...patch }];
      });
      activate(id);
    },
    [activate],
  );

  const close = useCallback(
    (id: string) => {
      setTabs((ts) => {
        const i = ts.findIndex((t) => t.id === id);
        if (i < 0) return ts;
        const rest = ts.filter((t) => t.id !== id);
        if (id === active) activate(rest[i]?.id ?? rest[i - 1]?.id ?? null);
        return rest;
      });
    },
    [active, activate],
  );

  const patchTab = useCallback((id: string, patch: Partial<Omit<TabState, "id">>) => {
    setTabs((ts) => {
      const t = ts.find((x) => x.id === id);
      if (!t || Object.entries(patch).every(([k, v]) => t[k as keyof TabState] === v)) return ts;
      return ts.map((x) => (x.id === id ? { ...x, ...patch } : x));
    });
  }, []);

  const createProject = useCallback(
    async (name: string) => {
      const p = await post<ProjectSummary>("/api/projects", { name });
      setProjects((ps) => (ps && !ps.some((x) => x.id === p.id) ? [p, ...ps] : ps));
      await open(p.id);
      return p;
    },
    [open],
  );

  const openFolder = useCallback(
    async (path: string, init = false) => {
      const p = await post<ProjectSummary>("/api/projects/open", { path, init });
      setProjects((ps) => (ps && !ps.some((x) => x.id === p.id) ? [p, ...ps] : ps));
      await open(p.id);
      return p;
    },
    [open],
  );

  // Once the projects are known: drop tabs of forgotten projects; first launch opens the default project.
  const first = useRef(true);
  useEffect(() => {
    if (!projects) return;
    const known = new Set(projects.map((p) => p.id));
    const kept = tabs.filter((t) => known.has(t.id));
    if (kept.length !== tabs.length) {
      setTabs(kept);
      if (active && !known.has(active)) activate(kept[0]?.id ?? null);
    }
    if (first.current) {
      first.current = false;
      if (!saved.current && !kept.length) {
        const def = projects.find((p) => p.isDefault && !p.missing) ?? projects.find((p) => !p.missing);
        if (def) void open(def.id);
      }
    }
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useCallback((id: string | null | undefined) => (id ? projects?.find((p) => p.id === id) : undefined), [projects]);

  const value = useMemo(
    () => ({ projects, connected, tabs, active, open, activate, close, patchTab, createProject, openFolder, summary }),
    [projects, connected, tabs, active, open, activate, close, patchTab, createProject, openFolder, summary],
  );
  return <ProjectsCtx.Provider value={value}>{children}</ProjectsCtx.Provider>;
}

/** The global job scheduler (every project), polled while `on`. */
export function useJobs(on: boolean, everyMs = 1200): SchedulerState | null {
  const [s, setS] = useState<SchedulerState | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = () =>
      get<SchedulerState>("/api/jobs")
        .then((x) => alive && setS(x))
        .catch(() => {})
        .finally(() => {
          if (alive) t = setTimeout(tick, everyMs);
        });
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [on, everyMs]);
  return s;
}

/** True when the server said the folder is not a Cezane project (opening it needs `init`). */
export const notAProject = (e: unknown) => e instanceof ApiError && /cezane\.json|not a (cezane )?project|no project/i.test(e.message);
