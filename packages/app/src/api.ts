import type { Asset, ServerEvent } from "@cezane/core";
import { mockFetch, mockSubscribe } from "./mock";

export const isMock = new URLSearchParams(location.search).has("mock");

export class ApiError extends Error {}

/** Calls the cezane server (or the in-browser mock with ?mock=1). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
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

/** Server-sent events; reconnects on error. Returns an unsubscribe function. */
export function subscribe(onEvent: (e: ServerEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  if (isMock) {
    onStatus?.(true);
    return mockSubscribe(onEvent);
  }
  let es: EventSource | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    es = new EventSource("/api/events");
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
export const fileUrl = (rel: string) => (isMock && rel.startsWith("mock/") ? `/mock-media/${enc(rel.slice(5))}` : `/files/project/${enc(rel)}`);
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
