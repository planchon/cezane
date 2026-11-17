import type { Asset, ProjectsEvent, ServerEvent } from "@cezane/core";
import { mockFetch, mockSubscribe, mockSubscribeProjects } from "./mock";

export const isMock = new URLSearchParams(location.search).has("mock");

export class ApiError extends Error {}

// ───────── the active project (the selected tab) ─────────

let projectId: string | undefined;

/** The project the project routes go to (the active tab); undefined: the server's default project. */
export const activeProject = () => projectId;

/** Set by the tabs before they render another project, so every call and file URL follows the tab. */
export function setActiveProject(id: string | undefined) {
  projectId = id;
}

/** Routes about every project, never prefixed. */
const GLOBAL = /^\/api\/(projects|jobs|settings|setup|p)(\/|\?|$)/;

/**
 * The URL of a project route for the active project: `/api/state` → `/api/p/<id>/state`,
 * `/files/project/x` → `/files/p/<id>/x`. Global routes and already scoped paths are unchanged.
 */
export function scopedPath(path: string, id = projectId): string {
  if (!id) return path;
  if (path.startsWith("/files/project/")) return `/files/p/${encodeURIComponent(id)}/${path.slice("/files/project/".length)}`;
  if (!path.startsWith("/api/") || GLOBAL.test(path)) return path;
  return `/api/p/${encodeURIComponent(id)}${path.slice(4)}`;
}

/** Calls the cezane server (or the in-browser mock with ?mock=1). Project routes go to the active tab's project. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  path = scopedPath(path);
  if (isMock) return mockFetch(method, path, body) as Promise<T>;
  const res = await fetch(path, {
    method,
    headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
    } catch {}
    throw new ApiError(msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});

/** Server-sent events of the active project (or `project`); reconnects on error. Returns an unsubscribe function. */
export function subscribe(onEvent: (e: ServerEvent) => void, onStatus?: (connected: boolean) => void, project = projectId): () => void {
  if (isMock) {
    onStatus?.(true);
    return mockSubscribe(onEvent, project);
  }
  return eventSource(scopedPath("/api/events", project), onEvent, onStatus);
}

/** Server-sent events about every project (tabs, home). */
export function subscribeProjects(onEvent: (e: ProjectsEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  if (isMock) {
    onStatus?.(true);
    return mockSubscribeProjects(onEvent);
  }
  return eventSource("/api/projects/events", onEvent, onStatus);
}

function eventSource<E>(url: string, onEvent: (e: E) => void, onStatus?: (connected: boolean) => void): () => void {
  let es: EventSource | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    es = new EventSource(url);
    es.onopen = () => onStatus?.(true);
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {}
    };
    es.onerror = () => {
      onStatus?.(false);
      es?.close();
      if (!closed) retry = setTimeout(open, 1500);
    };
  };
  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    es?.close();
  };
}

export async function uploadFiles(files: File[]): Promise<Asset[]> {
  const fd = new FormData();
  for (const f of files) fd.append("file", f, f.name);
  return api<Asset[]>("POST", "/api/upload", fd);
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
export const fileUrl = (rel: string) => (isMock && rel.startsWith("mock/") ? `/mock-media/${enc(rel.slice(5))}` : scopedPath(`/files/project/${enc(rel)}`));
export const cacheUrl = (hash: string, file: string) =>
  isMock ? `/mock-media/${enc(file)}` : `/files/cache/${encodeURIComponent(hash)}/${enc(file)}`;
export const brandUrl = (file: string) => `/brand/${file}`;

/** Best still image for an asset (poster for videos, the image itself for images). */
export function assetThumb(a: Asset): string | undefined {
  if (a.kind === "image") return a.derived.normalized ? cacheUrl(a.hash, a.derived.normalized) : fileUrl(a.file);
  if (a.derived.poster) return cacheUrl(a.hash, a.derived.poster);
  return undefined;
}

/** Playable/displayable media URL for an asset. */
export function assetMedia(a: Asset): string {
  return a.derived.normalized ? cacheUrl(a.hash, a.derived.normalized) : fileUrl(a.file);
}
