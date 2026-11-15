import type { Asset, CanvasDoc, Comment, Montage, Project, Region, Version, Word } from "./schema";

// ───────────────────────── Render contract (server → Remotion) ─────────────────────────

/** What the Remotion `Timeline` composition needs about an asset: URLs served by the cezane server. */
export type RenderAsset = {
  kind: Asset["kind"];
  url: string; // normalized video (H.264 CFR mp4), image, or audio
  width?: number;
  height?: number;
  duration?: number; // seconds
  cutoutUrl?: string; // webm vp9 with alpha
};

/** Input props of the `Timeline` composition (and of `Look`). */
export type TimelineProps = {
  montage: Montage;
  assets: Record<string, RenderAsset>;
};

/** Input props of the `Look` composition: several labeled frames in one image, for Claude. */
export type LookItem = { label: string; frame: number; montage?: Montage; region?: Region };
export type LookProps = TimelineProps & { items: LookItem[]; columns?: number };

/**
 * Render worker protocol (packages/remotion/src/worker.ts), JSON lines over stdin/stdout.
 * Request: { id, cmd, args }  Response: { id, ok: true, result } | { id, ok: false, error } | { id, progress }.
 */
export type WorkerRequest =
  | { id: string; cmd: "bundle"; args: { force?: boolean } }
  | {
      id: string;
      cmd: "segment";
      args: { props: TimelineProps; start: number; end: number; out: string };
    }
  | { id: string; cmd: "still"; args: { props: TimelineProps; frame: number; out: string; scale?: number } }
  | { id: string; cmd: "look"; args: { props: LookProps; out: string } }
  | { id: string; cmd: "graphicStill"; args: { component: string; props: Record<string, unknown>; frame: number; out: string } };
export type WorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }
  | { id: string; progress: number };

// ───────────────────────── Server ↔ UI contract ─────────────────────────

export type Job = {
  id: string;
  kind: "ingest" | "render" | "generate" | "capture" | "cutout";
  label: string;
  status: "queued" | "running" | "done" | "error";
  progress: number; // 0..1
  error?: string;
  result?: { assetId?: string; versionId?: string; [k: string]: unknown };
  createdAt: string;
};

export type ClaudeEvent = {
  id: string;
  at: string;
  kind: "start" | "text" | "tool" | "tool_result" | "permission" | "permission_done" | "end" | "error";
  text?: string;
  tool?: string;
  input?: unknown;
  ok?: boolean;
  permissionId?: string;
  costUsd?: number;
};

export type ClaudeStatus = { running: boolean; task?: string; startedAt?: string; model: string };

export type ServerState = {
  dir: string;
  project: Project;
  montage: Montage;
  revision: number;
  comments: Comment[];
  versions: Version[];
  jobs: Job[];
  claude: ClaudeStatus;
};

/** Server-sent events on GET /api/events. */
export type ServerEvent =
  | { type: "state"; state: ServerState }
  | { type: "claude"; event: ClaudeEvent }
  | { type: "canvas"; canvasId: string; put: unknown[]; remove: string[] };

export type ModelInfo = {
  provider: string; // "codex" | "claude" | "fal" | …
  id: string;
  label: string;
  kind: "image" | "video" | "text" | "audio";
  inputs: "none" | "images" | "text";
  costEur: number; // estimate per run (0 for subscription providers)
  available: boolean;
  note?: string;
};

export type GenerateRequest = {
  provider: string;
  model: string;
  kind: ModelInfo["kind"];
  prompt: string;
  inputs?: string[]; // asset ids
  canvasId?: string;
  shapeId?: string; // generation card that receives the result
  confirmCostEur?: number; // must be >= the estimate for paid providers
};

export type Workflow = { id: string; name: string; createdAt: string; shapes: unknown[]; bindings: unknown[] };

export type GraphicInfo = { name: string; description: string; props: Record<string, string>; defaultDuration: number };

/**
 * HTTP API of `cezane serve` (127.0.0.1:4317). All JSON.
 *
 * GET    /api/state                       ServerState
 * GET    /api/events                      SSE stream of ServerEvent
 * GET    /api/claude/log                  ClaudeEvent[] (current/last session)
 * POST   /api/claude/send   {commentIds?} send draft comments to Claude (all drafts when omitted)
 * POST   /api/claude/ask    {text}        free instruction to Claude
 * POST   /api/claude/stop
 * POST   /api/claude/permission/:id {allow, message?}
 * POST   /api/comments      {anchor, text, snapshot?: dataURL jpeg}  → Comment (draft)
 * POST   /api/comments/:id/reply {text}   user message; a fixed comment becomes reopened
 * POST   /api/comments/:id/status {status: "validated" | "reopened" | "draft"}
 * DELETE /api/comments/:id
 * POST   /api/render        {summary?}    render a new version → Job
 * POST   /api/versions/:id/restore        restore a version's montage as a new revision
 * POST   /api/undo                        revert the last montage revision
 * POST   /api/import        {paths}       import local files → Asset[]
 * POST   /api/upload        multipart "file" fields → Asset[]
 * GET    /api/transcript/:assetId         Transcript | null
 * GET    /api/waveform/:assetId           number[] | null
 * GET    /api/graphics                    GraphicInfo[]
 * GET    /api/canvases                    {id,name}[]
 * POST   /api/canvases      {name}        → CanvasDoc
 * GET    /api/canvas/:id                  CanvasDoc
 * PUT    /api/canvas/:id    {snapshot}
 * GET    /api/models                      ModelInfo[]
 * POST   /api/generate      GenerateRequest → Job (result.assetId when done)
 * GET    /api/workflows                   Workflow[]
 * POST   /api/workflows     {name, shapes, bindings} → Workflow
 * GET    /files/project/<path>            project files (Range supported)
 * GET    /files/cache/<hash>/<file>       ingestion derivatives (Range supported)
 */
export type ApiDoc = never;

export type { Asset, CanvasDoc, Comment, Montage, Project, Version, Word };
