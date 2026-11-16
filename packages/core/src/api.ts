import type { Asset, CanvasDoc, Comment, Montage, Project, Provenance, Region, Version, Word } from "./schema";

// ───────────────────────── Render contract (server → Remotion) ─────────────────────────

/** What the Remotion `Timeline` composition needs about an asset: URLs served by the cezane server. */
export type RenderAsset = {
  kind: Asset["kind"];
  url: string; // normalized video (H.264 CFR mp4), image, or audio
  width?: number;
  height?: number;
  duration?: number; // seconds
  cutoutUrl?: string; // webm vp9 with alpha
  subject?: SubjectTrack; // where the person is, for text behind them
  footage?: boolean; // imported footage (gets the montage grade); captures and generated images do not
  graded?: Record<string, { url: string; cutoutUrl?: string }>; // gradeFileKey → graded copies
  events?: CaptureEvent[]; // what happened during a screen recording (drives the cursor overlay)
};

/**
 * One interaction of a screen recording: t in seconds of the recording, x/y 0..1 of the frame.
 * A drag goes from (x, y) to (x2, y2) (an iOS scroll); "scroll" is a mouse wheel.
 */
export type CaptureEvent = {
  t: number;
  type: "click" | "drag" | "scroll" | "type" | "press" | "hover" | "goto";
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  label?: string;
};

/**
 * Where the person is in a video, sampled over time (source coordinates, 0..1, top-left origin).
 * Row: [t (s), x, y, w, h (silhouette box), area, faceX, faceY, faceW, faceH, headTop (hair top above
 * the face)]; -1 when absent.
 */
export type SubjectTrack = { fps: number; frames: number[][] };

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
  projectId?: string; // owner project (jobs share one scheduler across projects)
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
  projectId: string; // registry id: /api/p/<projectId>/… targets this project
  dir: string;
  project: Project;
  montage: Montage;
  revision: number;
  comments: Comment[];
  versions: Version[];
  jobs: Job[];
  claude: ClaudeStatus;
};

/** Server-sent events on GET /api/events and GET /api/p/:projectId/events. */
export type ServerEvent =
  | { type: "state"; state: ServerState }
  | { type: "claude"; event: ClaudeEvent }
  | { type: "canvas"; canvasId: string; put: unknown[]; remove: string[] }
  | { type: "files"; projectId: string }; // the project folders changed: refetch GET …/files

// ───────────────────────── Projects (home tab) ─────────────────────────

/** A reel = a montage of a project. Status and thumbnail come from its latest version. */
export type ReelSummary = {
  id: string; // montage id
  name: string;
  status: "draft" | "rendering" | "ready" | "error"; // draft: never rendered
  versions: number;
  lastVersion?: { id: string; n: number; status: Version["status"]; createdAt: string; durationSeconds: number };
  thumbUrl?: string; // poster of the latest ready version
  videoUrl?: string; // latest ready render
  exportUrl?: string; // the same render in Exports/
};

export type ProjectSummary = {
  id: string; // stable registry id, used in /api/p/:projectId/…
  name: string;
  path: string; // absolute folder
  location: "projets" | "external" | "demo"; // ~/Cezane/Projets, a folder opened from elsewhere, a repo demo
  missing?: boolean; // the folder is gone (moved or deleted)
  loaded: boolean; // open in the server (watcher, Claude runner)
  isDefault: boolean; // the project of the unscoped /api/… routes
  createdAt?: string;
  modifiedAt: string; // latest change of the project documents
  reels: ReelSummary[];
  assets: number;
  claudeRunning?: boolean;
  jobs?: { running: number; queued: number };
};

/** Server-sent events on GET /api/projects/events (home tab). */
export type ProjectsEvent = { type: "projects"; projects: ProjectSummary[] };

/** Global job scheduler: limits and every job of every project. */
export type SchedulerState = {
  limits: Record<Job["kind"], number>; // global concurrency per kind (capture is always 1)
  perProject: Partial<Record<Job["kind"], number>>; // at most this many per project (render: 1)
  jobs: Job[];
};

// ───────────────────────── Files (Médias view) ─────────────────────────

export type MediaFolderName = "Rushes" | "Générés" | "Captures" | "Exports";

export type ProjectFile = {
  path: string; // relative to the project, "/"-separated, NFC: "Rushes/plage 2.mov"
  name: string; // "plage 2.mov"
  folder: MediaFolderName; // top folder
  kind: "video" | "image" | "audio" | "other";
  size: number; // bytes
  createdAt: string;
  modifiedAt: string;
  url: string; // the file itself (Range supported): /files/p/<projectId>/<path>
  thumbUrl?: string; // small still (poster of a video, the image, a render poster)
  posterUrl?: string; // larger still for videos
  duration?: number; // seconds
  width?: number;
  height?: number;
  fps?: number;
  assetId?: string; // the asset made from this file (absent: being ingested, duplicate, or not media)
  assetName?: string;
  status?: Asset["status"];
  error?: string;
  duplicateOf?: string; // same content as this asset (stored elsewhere): not imported twice
  provenance?: Provenance;
  /** Generated files: the recipe in plain fields, plus the reference assets it was made from. */
  generated?: { prompt: string; provider: string; model: string; cost?: number; references: { assetId: string; name?: string; path?: string }[] };
  capture?: { source: string; target: string };
  version?: { id: string; n: number; montageId: string; summary: string }; // Exports/: the version it is
  usedIn?: string[]; // montage ids whose current cut uses the asset
};

export type FolderNode = { name: string; path: string; folders: FolderNode[]; files: ProjectFile[] };

/** GET /api/p/:projectId/files */
export type FilesListing = {
  projectId: string;
  root: string; // absolute project folder
  folders: FolderNode[]; // Rushes, Générés, Captures, Exports (always present, maybe empty)
  missing: { assetId: string; name: string; path: string; usedIn: string[] }[]; // deleted from the Finder but still used
};

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
 * HTTP API of `cezane serve` (127.0.0.1:4317). All JSON. One server serves every open project.
 *
 * Projects (global):
 * GET    /api/projects                    ProjectSummary[] (most recently modified first)
 * GET    /api/projects/events             SSE stream of ProjectsEvent (home tab)
 * GET    /api/projects/:id                ProjectSummary
 * POST   /api/projects  {name}            create ~/Cezane/Projets/<name>/ → ProjectSummary
 * POST   /api/projects/open {path, init?} remember an existing folder (init: create cezane.json if absent) → ProjectSummary
 * DELETE /api/projects/:id                forget (close) a project; its folder is left untouched
 * GET    /api/jobs                        SchedulerState (every project)
 *
 * Project routes: each one exists as /api/p/:projectId/<route> and, for the default project
 * (the folder given to `cezane serve`), as the unscoped /api/<route>.
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
 * GET    /api/files                       FilesListing (Rushes, Générés, Captures, Exports)
 * POST   /api/reveal        {path? | assetId? | versionId?}  show in the Finder (`open -R`); nothing = the project folder
 * POST   /api/capture       {target: "web"|"ios", mode?, url?, …} → Job (one capture at a time, all projects)
 * POST   /api/versions/:id/export         (re)link a ready render into Exports/ → Version
 * POST   /api/mcp                         MCP endpoint of the project (Claude); the default project is also on /mcp
 * GET    /files/p/:projectId/<path>       project files (Range supported); /files/project/<path> = default project
 * GET    /files/cache/<hash>/<file>       ingestion derivatives (Range supported, shared by all projects)
 */
export type ApiDoc = never;

export type { Asset, CanvasDoc, Comment, Montage, Project, Version, Word };
