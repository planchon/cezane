// In-browser fake server for UI work without `cezane serve` (open the app with ?mock=1).
import type {
  Asset,
  CanvasDoc,
  ClaudeEvent,
  Comment,
  GenerateRequest,
  GraphicInfo,
  Job,
  ModelInfo,
  Montage,
  ProjectsEvent,
  ProjectSummary,
  ReelSummary,
  SchedulerState,
  ServerEvent,
  ServerState,
  Version,
  Workflow,
} from "@cezane/core";
import { DEFAULT_PERMISSIONS, isCustomPermissions, LEVEL_PRESETS, type PermissionsPatch, type PermissionsView, SAFE_COMMANDS } from "@cezane/core";

const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
let seq = 100;
const id = (p: string) => `${p}_${(seq++).toString(36)}`;

const asset = (a: Partial<Asset> & Pick<Asset, "id" | "kind" | "name">): Asset => ({
  hash: a.id,
  file: `mock/${a.id}`,
  hasAudio: a.kind !== "image",
  provenance: { type: "import", path: `/Users/paul/Movies/${a.name}` },
  derived: {},
  status: "ready",
  tags: [],
  createdAt: ago(90),
  ...a,
});

const assets: Asset[] = [
  asset({ id: "a_rush1", kind: "video", name: "story-vertical.mp4", duration: 62.4, width: 1080, height: 1920, fps: 30, derived: { normalized: "v2.mp4", poster: "poster-rush1.jpg", transcript: "t.json" } }),
  asset({ id: "a_rush2", kind: "video", name: "slow-living-pauses.mp4", duration: 95.1, width: 1920, height: 1080, fps: 30, derived: { normalized: "v2.mp4", poster: "poster-rush2.jpg", transcript: "t.json" } }),
  asset({ id: "a_rush3", kind: "video", name: "vlog-fr-andie.mp4", duration: 71.0, width: 1920, height: 1080, fps: 25, derived: { poster: "poster-rush3.jpg" } }),
  asset({ id: "a_hevc", kind: "video", name: "iphone-hevc-test.mov", duration: 20, width: 1920, height: 1080, status: "ingesting" }),
  asset({
    id: "a_gen1",
    kind: "image",
    name: "Pommes, nature morte",
    derived: { normalized: "gen-apples.png" },
    provenance: { type: "generated", provider: "codex", model: "gpt-image", prompt: "Nature morte de pommes à la Cézanne", inputs: [], settings: {} },
  }),
  asset({
    id: "a_cap1",
    kind: "image",
    name: "rewind.codes — accueil",
    derived: { normalized: "capture-web.jpg" },
    provenance: { type: "capture", source: "web", target: "https://rewind.codes" },
  }),
  asset({ id: "a_music", kind: "audio", name: "Housewife — Tate McRae.m4a", duration: 88, hasAudio: true }),
  asset({ id: "a_bad", kind: "video", name: "corrompu.mov", status: "error", error: "ffprobe: moov atom not found" }),
];

const words = "Trois astuces pour filmer avec ton téléphone sans matériel pro et sans prise de tête".split(" ");
const montage: Montage = {
  id: "m_demo",
  name: "Démo",
  settings: { width: 1080, height: 1920, fps: 30, background: "#000000" },
  audio: { targetLufs: -14, voice: "clean", duck: true, duckDb: -12 },
  tracks: [
    {
      id: "t_main", kind: "video", name: "Main", role: "main", muted: false, hidden: false,
      clips: [
        { id: "c_1", type: "media", assetId: "a_rush1", start: 0, duration: 240, srcIn: 2.1, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0, fit: "cover", focus: { x: 0.5, y: 0.5 }, cutout: false, opacity: 1 },
        { id: "c_2", type: "media", assetId: "a_rush1", start: 240, duration: 180, srcIn: 11.4, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0, fit: "cover", focus: { x: 0.5, y: 0.4 }, cutout: false, opacity: 1, zoom: { from: 1, to: 1.2, x: 0.5, y: 0.4, easing: "punch" } },
        { id: "c_3", type: "media", assetId: "a_rush2", start: 420, duration: 180, srcIn: 30, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 10, fit: "cover", focus: { x: 0.5, y: 0.5 }, cutout: false, opacity: 1 },
      ],
    },
    {
      id: "t_broll", kind: "overlay", name: "B-roll", role: "broll", muted: false, hidden: false,
      clips: [{ id: "c_4", type: "media", assetId: "a_cap1", start: 300, duration: 90, srcIn: 0, speed: 1, volume: 1, muted: true, fadeIn: 0, fadeOut: 0, fit: "contain", focus: { x: 0.5, y: 0.5 }, cutout: false, opacity: 1 }],
    },
    {
      id: "t_gfx", kind: "overlay", name: "Graphics", role: "graphics", muted: false, hidden: false,
      clips: [
        { id: "c_5", type: "graphic", component: "Title", start: 0, duration: 75, props: { text: "3 astuces pour filmer" } },
      ],
    },
    {
      id: "t_caps", kind: "overlay", name: "Captions", role: "captions", muted: false, hidden: false,
      clips: [{ id: "c_7", type: "captions", start: 0, duration: 600, style: "clean", position: "bottom", words: words.map((w, i) => ({ text: w, start: i * 12, end: i * 12 + 10 })) }],
    },
    {
      id: "t_music", kind: "audio", name: "Music", role: "music", muted: false, hidden: false,
      clips: [{ id: "c_8", type: "media", assetId: "a_music", start: 0, duration: 600, srcIn: 12, speed: 1, volume: 0.4, muted: false, fadeIn: 15, fadeOut: 30, fit: "cover", focus: { x: 0.5, y: 0.5 }, cutout: false, opacity: 1 }],
    },
  ],
};

const v1Montage: Montage = structuredClone(montage);
v1Montage.tracks[0]!.clips[1] = { ...(v1Montage.tracks[0]!.clips[1] as any), zoom: undefined, start: 240, duration: 210 };
v1Montage.tracks[0]!.clips[2] = { ...(v1Montage.tracks[0]!.clips[2] as any), start: 450 };

const version = (n: number, rev: number, extra: Partial<Version>): Version => ({
  id: `v${n}`, n, montageId: "m_demo", revision: rev, author: "claude", summary: "", status: "ready", progress: 1,
  file: `mock/v${n}.mp4`, poster: `mock/poster-rush1.jpg`, montageFile: `.cezane/versions/v${n}.json`, durationFrames: 600, fps: 30,
  changed: [], comments: [], segmentKeys: [], createdAt: ago(60 - n * 20), ...extra,
});

const versions: Version[] = [
  version(1, 6, { author: "user", summary: "Premier montage : coupe des silences, sous-titres, titre." , durationFrames: 630 }),
  version(2, 12, { summary: "Zoom punch-in sur l'astuce 2, plan 3 avancé de 1 s, sous-titres corrigés.", changed: [{ start: 240, end: 420 }, { start: 420, end: 510 }], comments: ["k_2"], renderSeconds: 41 }),
];

const msg = (author: "user" | "claude", text: string, minutes: number, versionId?: string) => ({ author, text, at: ago(minutes), versionId });
const comments: Comment[] = [
  { id: "k_1", n: 1, status: "validated", anchor: { kind: "montage", montageId: "m_demo", versionId: "v1", frame: 12, content: { clipId: "c_1", assetId: "a_rush1", srcTime: 2.5 } }, thread: [msg("user", "Le titre arrive trop tard.", 50), msg("claude", "Titre avancé à la frame 0.", 40, "v2")], fixedIn: "v2", createdAt: ago(50) },
  { id: "k_2", n: 2, status: "fixed", anchor: { kind: "montage", montageId: "m_demo", versionId: "v1", frame: 260, region: { x: 0.2, y: 0.25, w: 0.6, h: 0.3 }, content: { clipId: "c_2", assetId: "a_rush1", srcTime: 12.1 } }, thread: [msg("user", "Zoom sur mon visage ici, c'est le moment clé.", 48), msg("claude", "Ajouté un punch-in 1 → 1,2 centré sur le visage (c_2).", 39, "v2")], fixedIn: "v2", snapshot: "mock/poster-rush1.jpg", createdAt: ago(48) },
  { id: "k_3", n: 3, status: "in_progress", anchor: { kind: "montage", montageId: "m_demo", versionId: "v2", frame: 330, pin: { x: 0.5, y: 0.62 }, content: { clipId: "c_4", assetId: "a_cap1", srcTime: 1 } }, thread: [msg("user", "La capture est trop petite, mets-la dans un cadre navigateur.", 12)], createdAt: ago(12) },
  { id: "k_4", n: 4, status: "sent", anchor: { kind: "montage", montageId: "m_demo", versionId: "v2", frame: 450, frameEnd: 540, content: { clipId: "c_3", assetId: "a_rush2", srcTime: 31 } }, thread: [msg("user", "Ce passage est trop lent, coupe les hésitations.", 11)], createdAt: ago(11) },
  { id: "k_5", n: 5, status: "draft", anchor: { kind: "montage", montageId: "m_demo", versionId: "v2", frame: 96, pin: { x: 0.3, y: 0.83 } }, thread: [msg("user", "Le lower third cache les sous-titres.", 3)], createdAt: ago(3) },
  { id: "k_6", n: 6, status: "draft", anchor: { kind: "montage", montageId: "m_demo", versionId: "v2", frame: 560, frameEnd: 600 }, thread: [msg("user", "Finir sur un fondu au noir avec la musique.", 2)], createdAt: ago(2) },
  { id: "k_7", n: 7, status: "reopened", anchor: { kind: "montage", montageId: "m_demo", versionId: "v2", frame: 30, region: { x: 0.1, y: 0.1, w: 0.8, h: 0.15 } }, thread: [msg("user", "Titre plus gros.", 45), msg("claude", "Taille passée de 96 à 120 px.", 38, "v2"), msg("user", "Toujours trop petit, et en jaune ocre.", 5)], fixedIn: "v2", createdAt: ago(45) },
];

const jobs: Job[] = [
  { id: "j_0", projectId: "demo", montageId: "m_demo", kind: "render", label: "Rendu V3 · segments 4/9", status: "running", progress: 0.62, createdAt: ago(1) },
  { id: "j_1", projectId: "demo", kind: "ingest", label: "Import iphone-hevc-test.mov", status: "running", progress: 0.45, createdAt: ago(1) },
];

let state: ServerState = {
  projectId: "demo",
  dir: "/Users/paul/Cezane/projects/demo",
  project: { name: "Démo Cezane", createdAt: ago(300), settings: { claudeModel: "sonnet", budgetEur: 5, spentEur: 0.35 }, assets, montages: [{ id: "m_demo", name: "Démo" }], canvases: [{ id: "cv_1", name: "Idées" }] },
  montage,
  revision: 14,
  comments,
  versions,
  jobs,
  claude: { running: true, task: "Traite 2 commentaires", startedAt: ago(1), model: "sonnet" },
};

const ev = (e: Omit<ClaudeEvent, "id" | "at">, min: number): ClaudeEvent => ({ id: id("e"), at: ago(min), ...e });
let claudeLog: ClaudeEvent[] = [
  ev({ kind: "start", text: "Traite 2 commentaires (#3, #4)" }, 1.2),
  ev({ kind: "tool", tool: "mcp__cezane__overview", input: {} }, 1.1),
  ev({ kind: "tool_result", tool: "mcp__cezane__overview", ok: true, text: "Montage m_demo 600f, 5 pistes, 7 commentaires" }, 1.1),
  ev({ kind: "tool", tool: "mcp__cezane__comment_context", input: { ids: ["k_3", "k_4"] } }, 1),
  ev({ kind: "tool_result", tool: "mcp__cezane__comment_context", ok: true }, 1),
  ev({ kind: "text", text: "Pour #4, je coupe les deux hésitations repérées dans le transcript (31,8 s et 33,1 s)." }, 0.9),
  ev({ kind: "tool", tool: "mcp__cezane__edit", input: { ops: [{ op: "cut_range", start: 468, end: 489 }, { op: "cut_range", start: 506, end: 520 }] } }, 0.8),
  ev({ kind: "tool_result", tool: "mcp__cezane__edit", ok: true, text: "rev 15 · cut 468–489f (0.70s) · cut 506–520f (0.47s)" }, 0.8),
  ev({ kind: "tool", tool: "mcp__cezane__look", input: { frames: [450, 470, 500] } }, 0.6),
  ev({ kind: "tool_result", tool: "mcp__cezane__look", ok: true }, 0.6),
  ev({ kind: "permission", tool: "Bash", input: { command: "magick identify Rushes/plage.png" }, permissionId: "p_1", text: "Claude veut lancer une commande.", alwaysRules: ["Bash(magick:*)"] }, 0.3),
];

const models: ModelInfo[] = [
  { provider: "codex", id: "gpt-image", label: "Codex · GPT Image", kind: "image", inputs: "images", costEur: 0, available: true },
  { provider: "claude", id: "sonnet", label: "Claude Sonnet", kind: "text", inputs: "text", costEur: 0, available: true },
  { provider: "fal", id: "fal-ai/flux-pro/v1.1", label: "FLUX 1.1 Pro", kind: "image", inputs: "none", costEur: 0.04, available: false, note: "clé FAL manquante" },
  { provider: "fal", id: "fal-ai/kling-video/v2/image-to-video", label: "Kling 2 · image → vidéo", kind: "video", inputs: "images", costEur: 0.35, available: false, note: "clé FAL manquante" },
  { provider: "fal", id: "fal-ai/elevenlabs/music", label: "Musique", kind: "audio", inputs: "text", costEur: 0.1, available: false, note: "clé FAL manquante" },
];

const graphics: GraphicInfo[] = [
  { name: "Title", description: "Titre animé", props: { text: "string" }, defaultDuration: 75 },
];

const canvases: CanvasDoc[] = [{ id: "cv_1", name: "Idées", pending: [], updatedAt: ago(20) }];
const workflows: Workflow[] = [];

// ───────── several projects (tabs, home): the demo above, plus two lighter ones ─────────

type MockProject = { state: ServerState; log: ClaudeEvent[]; reels: Montage[]; location: ProjectSummary["location"] };

const reelOf = (base: Montage, rid: string, name: string, keep = true): Montage => ({
  ...structuredClone(base),
  id: rid,
  name,
  tracks: keep ? structuredClone(base.tracks) : base.tracks.map((t) => ({ ...structuredClone(t), clips: t.role === "main" ? structuredClone(t.clips.slice(0, 2)) : [] })),
});
const versionOf = (pid: string, mid: string, n: number, extra: Partial<Version> = {}): Version => ({ ...version(n, 3, extra), id: `v${n}`, montageId: mid, file: `mock/v2.mp4`, createdAt: ago(60 * 24 * (3 - n)) });
const projectState = (pid: string, name: string, reels: Montage[], versions: Version[], comments: Comment[] = []): ServerState => ({
  projectId: pid,
  dir: `/Users/paul/Cezane/Projets/${name}`,
  project: { name, createdAt: ago(60 * 24 * 7), settings: { claudeModel: "sonnet", budgetEur: 5, spentEur: 0 }, assets, montages: reels.map((m) => ({ id: m.id, name: m.name })), canvases: [] },
  montage: reels[0]!,
  revision: 3,
  comments,
  versions,
  jobs: [],
  claude: { running: false, model: "sonnet" },
});

state.project.name = "Démo Cezane";
const daxReels = [reelOf(montage, "m_dax1", "Un coach codé en 72 h"), reelOf(montage, "m_dax2", "L'onboarding refait", false)];
const daxComments: Comment[] = [
  { ...structuredClone(comments[1]!), id: "k_d1", n: 1, anchor: { kind: "montage", montageId: "m_dax1", versionId: "v2", frame: 260 } },
  { ...structuredClone(comments[6]!), id: "k_d2", n: 2, status: "fixed", anchor: { kind: "montage", montageId: "m_dax1", versionId: "v2", frame: 30 } },
];
const rewindReels = [reelOf(montage, "m_rw1", "Rewind retrouve tout")];
const projects = new Map<string, MockProject>([
  ["demo", { state, log: claudeLog, reels: [montage], location: "demo" }],
  ["dax", { state: projectState("dax", "Dax", daxReels, [versionOf("dax", "m_dax1", 1), versionOf("dax", "m_dax1", 2)], daxComments), log: [], reels: daxReels, location: "projets" }],
  ["rewind", { state: projectState("rewind", "Rewind", rewindReels, [versionOf("rewind", "m_rw1", 1, { author: "user" })]), log: [], reels: rewindReels, location: "projets" }],
]);
const DEFAULT = "demo";

const OPEN = new Set(["draft", "sent", "in_progress", "reopened"]);
function reelsOf(p: MockProject): ReelSummary[] {
  const st = p.state;
  return p.reels.map((m) => {
    const vs = st.versions.filter((v) => v.montageId === m.id);
    const last = vs.at(-1);
    const cs = st.comments.filter((c) => c.anchor.kind === "montage" && c.anchor.montageId === m.id);
    const posters = m.tracks.flatMap((t) => t.clips).flatMap((c) => (c.type === "media" ? [((a) => a?.derived.poster ?? (a?.kind === "image" ? a.derived.normalized : undefined))(assets.find((a) => a.id === c.assetId))] : [])).filter((x): x is string => Boolean(x));
    return {
      id: m.id,
      name: m.name,
      status: last?.status ?? "draft",
      versions: vs.length,
      lastVersion: last && { id: last.id, n: last.n, status: last.status, createdAt: last.createdAt, durationSeconds: last.durationFrames / last.fps, author: last.author },
      thumbUrl: last ? "/mock-media/poster-rush1.jpg" : undefined,
      active: m.id === st.montage.id,
      claude: st.claude.running && (st.claude.montageId ?? st.montage.id) === m.id ? true : undefined,
      frames: [...new Set(posters)].slice(0, 3).map((f) => `/mock-media/${f}`),
      comments: { open: cs.filter((c) => OPEN.has(c.status)).length, toReview: cs.filter((c) => c.status === "fixed").length },
      rushes: { aroll: new Set(m.tracks[0]!.clips.map((c) => (c.type === "media" ? c.assetId : ""))).size, broll: new Set(m.tracks[1]?.clips.map((c) => (c.type === "media" ? c.assetId : ""))).size },
    };
  });
}
function summary(pid: string, p: MockProject): ProjectSummary {
  const jobs = p.state.jobs;
  return {
    id: pid,
    name: p.state.project.name,
    path: p.state.dir,
    location: p.location,
    loaded: true,
    isDefault: pid === DEFAULT,
    createdAt: p.state.project.createdAt,
    modifiedAt: p.state.versions.at(-1)?.createdAt ?? p.state.project.createdAt,
    reels: reelsOf(p),
    assets: p.state.project.assets.length,
    claudeRunning: p.state.claude.running,
    jobs: { running: jobs.filter((j) => j.status === "running").length, queued: jobs.filter((j) => j.status === "queued").length },
  };
}
const summaries = () => [...projects].map(([pid, p]) => summary(pid, p)).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

const listeners = new Map<string, Set<(e: ServerEvent) => void>>();
const projectListeners = new Set<(e: ProjectsEvent) => void>();
const emit = (e: ServerEvent, pid = state.projectId) => listeners.get(pid)?.forEach((l) => l(e));
/** The state of `st`'s project to its listeners (the current request's project by default), and the home its summary. */
const emitState = (st = state) => {
  const p = projects.get(st.projectId);
  if (p) st.reels = reelsOf(p);
  emit({ type: "state", state: structuredClone(st) }, st.projectId);
  const all = summaries();
  projectListeners.forEach((l) => l({ type: "projects", projects: all }));
};
const pushClaude = (e: Omit<ClaudeEvent, "id" | "at">, log = claudeLog, pid = state.projectId) => {
  const full = { id: id("e"), at: now(), ...e };
  log.push(full);
  emit({ type: "claude", event: full }, pid);
};

export function mockSubscribe(on: (e: ServerEvent) => void, pid = DEFAULT) {
  if (!listeners.has(pid)) listeners.set(pid, new Set());
  listeners.get(pid)!.add(on);
  return () => listeners.get(pid)?.delete(on);
}

export function mockSubscribeProjects(on: (e: ProjectsEvent) => void) {
  projectListeners.add(on);
  setTimeout(() => on({ type: "projects", projects: summaries() }), 30);
  return () => projectListeners.delete(on);
}

function runJob(job: Job, done: () => void) {
  const st = state;
  job.projectId = st.projectId;
  st.jobs.push(job);
  emitState(st);
  const t = setInterval(() => {
    job.status = "running";
    job.progress = Math.min(1, job.progress + 0.25);
    if (job.progress >= 1) {
      clearInterval(t);
      job.status = "done";
      done();
    }
    emitState(st);
  }, 600);
}

/** ~/Cezane/settings.json: what Claude may do without asking. */
const permissions: PermissionsView = {
  ...structuredClone(DEFAULT_PERMISSIONS),
  rules: [{ rule: "Bash(git status:*)", addedAt: ago(60 * 26), example: "git status -s" }],
  file: "/Users/paul/Cezane/settings.json",
  home: "/Users/paul/Cezane",
  safeCommands: SAFE_COMMANDS,
  custom: false,
};
const permissionsView = (): PermissionsView => ({ ...structuredClone(permissions), custom: isCustomPermissions(permissions) });

/** Global routes (every project). */
function globalRoute(method: string, path: string, body: any): unknown {
  if (method === "GET" && path === "/api/settings/permissions") return permissionsView();
  if (method === "PUT" && path === "/api/settings/permissions") {
    const b = body as PermissionsPatch;
    if (b.level && b.level !== permissions.level) permissions.categories = { ...LEVEL_PRESETS[b.level] };
    if (b.level) permissions.level = b.level;
    Object.assign(permissions.categories, b.categories ?? {});
    return permissionsView();
  }
  if (method === "DELETE" && path === "/api/settings/permissions/rules") {
    permissions.rules = permissions.rules.filter((r) => r.rule !== body.rule);
    return permissionsView();
  }
  if (method === "GET" && path === "/api/projects") return summaries();
  if (method === "GET" && path === "/api/jobs") {
    const jobs = [...projects.values()].flatMap((p) => p.state.jobs);
    return { limits: { render: 2, capture: 1, ingest: 2, generate: 3, cutout: 1 }, perProject: { render: 1 }, jobs } satisfies SchedulerState;
  }
  if (method === "POST" && (path === "/api/projects" || path === "/api/projects/open")) {
    const name = path.endsWith("/open") ? String(body.path ?? "").split("/").filter(Boolean).at(-1) ?? "Dossier" : String(body.name ?? "").trim();
    if (!name) throw new Error("name required");
    const pid = name.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "projet";
    const reels = [{ ...structuredClone(montage), id: id("m"), name: "Montage", tracks: montage.tracks.map((t) => ({ ...structuredClone(t), clips: [] })) }];
    const st = projectState(pid, name, reels, []);
    st.project.assets = [];
    if (path.endsWith("/open")) st.dir = body.path;
    projects.set(pid, { state: st, log: [], reels, location: path.endsWith("/open") ? "external" : "projets" });
    emitState(st);
    return summary(pid, projects.get(pid)!);
  }
  let r: RegExpExecArray | null;
  if (method === "GET" && (r = /^\/api\/projects\/([\w.-]+)$/.exec(path))) return summary(r[1]!, projects.get(r[1]!)!);
  return undefined;
}

export async function mockFetch(method: string, rawPath: string, body: any): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 60));
  const g = globalRoute(method, rawPath, body);
  if (g !== undefined) return g;
  const scoped = /^\/api\/p\/([\w.-]+)(\/.*)$/.exec(rawPath);
  const pid = scoped?.[1] ?? DEFAULT;
  const proj = projects.get(pid);
  if (!proj) throw new Error(`unknown project ${pid}`);
  state = proj.state;
  claudeLog = proj.log;
  const path = scoped ? `/api${scoped[2]}` : rawPath;
  const m = (re: RegExp) => re.exec(path);
  let r: RegExpExecArray | null;
  if (method === "GET" && path === "/api/state") return structuredClone({ ...state, reels: reelsOf(proj) });
  if (method === "GET" && path === "/api/reels") return reelsOf(proj);
  if (method === "POST" && path === "/api/reels") {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("name required");
    const reel: Montage = { ...structuredClone(state.montage), id: id("m"), name, tracks: state.montage.tracks.map((t) => ({ ...structuredClone(t), clips: [] })) };
    proj.reels.push(reel);
    state.project.montages.push({ id: reel.id, name });
    if (body.select !== false) {
      state.montage = reel;
      state.revision = 0;
    }
    emitState();
    return reelsOf(proj).find((x) => x.id === reel.id);
  }
  if (method === "POST" && (r = m(/^\/api\/reels\/([\w-]+)\/select$/))) {
    const reel = proj.reels.find((x) => x.id === r![1]);
    if (!reel) throw new Error(`unknown reel ${r[1]}`);
    state.montage = reel;
    emitState();
    return structuredClone({ ...state, reels: reelsOf(proj) });
  }
  if (method === "PATCH" && (r = m(/^\/api\/reels\/([\w-]+)$/))) {
    const reel = proj.reels.find((x) => x.id === r![1]);
    const ref = state.project.montages.find((x) => x.id === r![1]);
    if (!reel || !ref) throw new Error(`unknown reel ${r[1]}`);
    reel.name = ref.name = String(body.name ?? "").trim() || reel.name;
    emitState();
    return reelsOf(proj).find((x) => x.id === reel.id);
  }
  if (method === "GET" && path === "/api/claude/log") return claudeLog;
  if (method === "GET" && (r = m(/^\/api\/versions\/(\w+)\/montage$/))) return r[1] === "v1" ? v1Montage : montage;
  if (method === "GET" && path === "/api/models") return models;
  if (method === "GET" && path === "/api/graphics") return graphics;
  if (method === "GET" && path === "/api/canvases") return canvases.map(({ id, name }) => ({ id, name }));
  if (method === "GET" && path === "/api/workflows") return workflows;
  if (method === "GET" && (r = m(/^\/api\/canvas\/(\w+)$/))) return canvases.find((c) => c.id === r![1]);
  if (method === "PUT" && (r = m(/^\/api\/canvas\/(\w+)$/))) {
    const c = canvases.find((c) => c.id === r![1]);
    if (c) Object.assign(c, { snapshot: body.snapshot, updatedAt: now() });
    return { ok: true };
  }
  if (method === "POST" && path === "/api/canvases") {
    const c: CanvasDoc = { id: id("cv"), name: body.name ?? "Canvas", pending: [], updatedAt: now() };
    canvases.push(c);
    return c;
  }
  if (method === "POST" && path === "/api/workflows") {
    const w = { id: id("w"), createdAt: now(), ...body } as Workflow;
    workflows.push(w);
    return w;
  }
  if (method === "POST" && path === "/api/comments") {
    const c: Comment = { id: id("k"), n: state.comments.length + 1, status: "draft", anchor: body.anchor, thread: [{ author: "user", text: body.text, at: now() }], createdAt: now() };
    state.comments.push(c);
    emitState();
    return c;
  }
  if (method === "POST" && (r = m(/^\/api\/comments\/(\w+)\/reply$/))) {
    const c = state.comments.find((c) => c.id === r![1]);
    if (c) {
      c.thread.push({ author: "user", text: body.text, at: now() });
      if (c.status === "fixed") c.status = "reopened";
    }
    emitState();
    return c;
  }
  if (method === "POST" && (r = m(/^\/api\/comments\/(\w+)\/status$/))) {
    const c = state.comments.find((c) => c.id === r![1]);
    if (c) c.status = body.status;
    emitState();
    return c;
  }
  if (method === "DELETE" && (r = m(/^\/api\/comments\/(\w+)$/))) {
    state.comments = state.comments.filter((c) => c.id !== r![1]);
    emitState();
    return { ok: true };
  }
  if (method === "POST" && path === "/api/claude/send") {
    const ids: string[] = body.commentIds ?? state.comments.filter((c) => c.status === "draft").map((c) => c.id);
    for (const c of state.comments) if (ids.includes(c.id)) c.status = "sent";
    state.claude = { running: true, task: `Traite ${ids.length} commentaire(s)`, startedAt: now(), model: "sonnet" };
    emitState();
    pushClaude({ kind: "start", text: state.claude.task });
    const [log, pid] = [claudeLog, state.projectId];
    setTimeout(() => pushClaude({ kind: "tool", tool: "mcp__cezane__comment_context", input: { ids } }, log, pid), 500);
    setTimeout(() => pushClaude({ kind: "text", text: "Je regarde les passages concernés." }, log, pid), 1000);
    return { ok: true };
  }
  if (method === "POST" && path === "/api/claude/ask") {
    state.claude = { running: true, task: body.text, startedAt: now(), model: "sonnet" };
    emitState();
    pushClaude({ kind: "start", text: body.text });
    const [log, pid] = [claudeLog, state.projectId];
    setTimeout(() => pushClaude({ kind: "text", text: "D'accord, je m'en occupe." }, log, pid), 600);
    return { ok: true };
  }
  if (method === "POST" && path === "/api/claude/stop") {
    state.claude = { running: false, model: "sonnet" };
    pushClaude({ kind: "end", text: "Arrêté", costUsd: 0.12 });
    emitState();
    return { ok: true };
  }
  if (method === "POST" && (r = m(/^\/api\/claude\/permission\/(\w+)$/))) {
    const asked = claudeLog.find((e) => e.kind === "permission" && e.permissionId === r![1]);
    const rules = body.allow && body.always && !asked?.paid ? (asked?.alwaysRules ?? []) : [];
    for (const rule of rules) if (!permissions.rules.some((x) => x.rule === rule)) permissions.rules.push({ rule, addedAt: now() });
    pushClaude({ kind: "permission_done", permissionId: r[1], ok: body.allow, text: rules.length ? `Toujours autorisé : ${rules.join(", ")}` : undefined });
    return { ok: true };
  }
  if (method === "POST" && path === "/api/render") {
    const n = state.versions.length + 1;
    const v = { ...version(n, state.revision, { status: "rendering", progress: 0, summary: body.summary ?? "Rendu manuel", author: "user" }), montageId: state.montage.id };
    state.versions.push(v);
    runJob({ id: id("j"), montageId: state.montage.id, kind: "render", label: `Rendu V${n}`, status: "queued", progress: 0, createdAt: now() }, () => {
      Object.assign(v, { status: "ready", progress: 1, file: "mock/v2.mp4", changed: [{ start: 450, end: 540 }] });
    });
    return { ok: true };
  }
  if (method === "POST" && path === "/api/generate") {
    const req = body as GenerateRequest;
    const job: Job = { id: id("j"), kind: "generate", label: `${req.kind} · ${req.model}`, status: "queued", progress: 0, createdAt: now() };
    runJob(job, () => {
      if (req.kind === "text") {
        job.result = { text: `SCRIPT — ${req.prompt}\n\n1. Plan large : la ruelle sous la pluie.\n2. Gros plan : le héros lève les yeux.\n3. Plan d'ensemble : la Sainte-Victoire au loin.` };
        return;
      }
      const a = asset({ id: id("a"), kind: "image", name: req.prompt.slice(0, 40), derived: { normalized: "gen-apples.png" }, provenance: { type: "generated", provider: req.provider, model: req.model, prompt: req.prompt, inputs: req.inputs ?? [], settings: {} } });
      state.project.assets.push(a);
      job.result = { assetId: a.id };
    });
    return job;
  }
  if (method === "POST" && (path === "/api/upload" || path === "/api/import")) {
    const files: File[] = body instanceof FormData ? (body.getAll("file") as File[]) : [];
    const added = files.map((f) => {
      const kind: Asset["kind"] = f.type.startsWith("image") ? "image" : f.type.startsWith("audio") ? "audio" : "video";
      const a = asset({ id: id("a"), kind, name: f.name, status: kind === "image" ? "ready" : "ingesting", derived: kind === "image" ? { normalized: "gen-apples.png" } : {} });
      state.project.assets.push(a);
      return a;
    });
    emitState();
    return added;
  }
  if (method === "POST" && (path === "/api/undo" || /\/restore$/.test(path))) {
    state.revision++;
    emitState();
    return { ok: true };
  }
  if (method === "GET" && /^\/api\/(transcript|waveform)\//.test(path)) return null;
  throw new Error(`mock: no route for ${method} ${path}`);
}
