import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Asset, Clip, Montage, RenderFailure, Version } from "@cezane/core";
import { CACHE_DIR, tailOf } from "@cezane/engine";

/**
 * Render failures: why a render failed (deterministic, from the files on disk and the error),
 * and what can fix it. See RenderFailure in core.
 */

/** Thrown by the render itself when it knows the cause (a file it needs is gone). */
export class RenderFailureError extends Error {
  constructor(
    readonly kind: RenderFailure["kind"],
    message: string,
    readonly assetIds?: string[],
  ) {
    super(message);
  }
}

/** Errors that may pass on a retry: the worker or Chrome died, a timeout, a busy resource. */
const TRANSIENT =
  /timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|EAGAIN|EBUSY|ENOMEM|socket hang up|render worker exited|Target closed|Session closed|Protocol error|browser has disconnected|net::ERR_|SIGKILL|SIGTERM|Resource temporarily unavailable|out of memory|cancelled|interrupted/i;

export const looksTransient = (text: string) => TRANSIENT.test(text);

/** Does this JSON (a clip, a montage) refer to the asset? Media clips and graphic props alike. */
const refersTo = (json: string, assetId: string) => json.includes(`"${assetId}"`);

/** The assets a montage uses (media clips, and graphics that take an asset in their props). */
export function usedAssets(m: Montage, assets: Asset[]): Asset[] {
  const json = JSON.stringify(m);
  return assets.filter((a) => refersTo(json, a.id));
}

/** The clips of a montage that use one of these assets. */
export function clipsUsing(m: Montage, assetIds: string[]): Clip[] {
  return m.tracks.flatMap((t) => t.clips).filter((c) => {
    const json = JSON.stringify(c);
    return assetIds.some((id) => refersTo(json, id));
  });
}

/** The cached files a render reads for an asset (undefined: never made). */
function renderFiles(a: Asset): (string | undefined)[] {
  if (a.kind === "audio") return [a.derived.audio];
  if (a.kind === "image") return [a.derived.normalized];
  return a.hasAudio ? [a.derived.normalized, a.derived.audio] : [a.derived.normalized];
}

const cacheOk = (a: Asset) => renderFiles(a).every((f) => f && existsSync(join(CACHE_DIR, a.hash, f)));

/**
 * Where the montage's assets stand for a render. Renders read the cache, so a file deleted from
 * the Finder only matters when its cache is gone too:
 * - missing: neither the cache nor the original file is there (only the user can bring it back);
 * - stale: the cache is gone but the original is there (the render can rebuild it).
 */
export function checkAssets(m: Montage, assets: Asset[], projectDir: string): { missing: Asset[]; stale: Asset[] } {
  const missing: Asset[] = [];
  const stale: Asset[] = [];
  for (const a of usedAssets(m, assets)) {
    if (cacheOk(a)) continue;
    if (existsSync(join(projectDir, a.file))) stale.push(a);
    else missing.push(a);
  }
  return { missing, stale };
}

export const missingMessage = (assets: Pick<Asset, "file">[]) =>
  `Fichier introuvable : ${assets.map((a) => a.file.split("/").at(-1)).join(", ")}`;

/**
 * Classifies a failed render. In order: the cause the render reported, a file the reel uses that is
 * gone (with its cache), an interruption, anything else (technical, maybe transient).
 */
export function classifyFailure(o: { error: unknown; missing?: Pick<Asset, "id" | "file">[]; logTail?: string; interrupted?: boolean }): RenderFailure {
  const raw = o.error instanceof Error ? o.error.message : String(o.error ?? "");
  const logTail = o.logTail?.trim() || undefined;
  if (o.error instanceof RenderFailureError && o.error.kind === "missing")
    return { kind: "missing", message: o.error.message, assetIds: o.error.assetIds, logTail };
  if (o.missing?.length) return { kind: "missing", message: missingMessage(o.missing), assetIds: o.missing.map((a) => a.id), logTail };
  if (o.interrupted || (o.error instanceof RenderFailureError && o.error.kind === "interrupted") || /^(interrupted|cancelled)$/.test(raw.trim()))
    return { kind: "interrupted", message: "Rendu interrompu : Cezane s'est fermé pendant le rendu.", logTail };
  const message = raw.trim().slice(0, 600) || "Erreur inconnue";
  return { kind: "technical", message, logTail, transient: looksTransient(`${raw}\n${logTail ?? ""}`) || undefined };
}

/** The render log of a version (.cezane/renders/<id>.log), its last `maxChars` characters. */
export function readRenderLog(projectDir: string, versionId: string, maxChars = 64_000): string {
  const p = join(projectDir, ".cezane/renders", `${versionId}.log`);
  if (!existsSync(p)) return "";
  const text = readFileSync(p, "utf8");
  return text.length > maxChars ? text.slice(text.indexOf("\n", text.length - maxChars) + 1) : text;
}

/** A failure for a version saved before failures were classified (or interrupted by a restart). */
export function legacyFailure(v: Pick<Version, "id" | "error">, projectDir: string, interrupted = false): RenderFailure {
  const logTail = tailOf(readRenderLog(projectDir, v.id)) || undefined;
  return classifyFailure({ error: interrupted ? "interrupted" : (v.error ?? ""), logTail });
}

/** The instruction given to Claude to repair a failed render. */
export function repairPrompt(o: { version: Version; failure: RenderFailure; log: string; revisionNow: number }): string {
  const { version: v, failure: f } = o;
  const log = tailOf(o.log || f.logTail || "", 60, 4000);
  return [
    `The render of version V${v.n} (${v.id}) failed. Repair the montage so that it renders.`,
    `Error: ${f.message}`,
    log ? `End of the render log:\n\`\`\`\n${log}\n\`\`\`` : "",
    v.revision !== o.revisionNow ? `V${v.n} was rendered from revision ${v.revision}; the montage is now at revision ${o.revisionNow}.` : "",
    "Steps:",
    "1. Call `overview`, then find the cause in the montage: the clip, graphic, asset, props, frame range or setting (grade, LUT…) the error points to.",
    "2. Fix it with the cezane tools (`edit`…), changing as little as possible. Leave the rest of the montage as it is.",
    "3. If the montage is not the cause (the error looks like a crash or comes from the machine), change nothing and say so.",
    "Do not call `render`: Cezane re-renders the reel as soon as you finish.",
    "End with one or two sentences in French: the cause, and what you changed.",
  ]
    .filter(Boolean)
    .join("\n");
}
