import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { CAPTION_STYLES, type LookItem, type Op, clipEnd, findClip, newId, OpError, overview, resolveAnchor } from "@cezane/core";
import { captionsOps, cutSilencesOps, ffmpeg, greenScreenOps, look, timelineWords, transcriptLines } from "@cezane/engine";
import type { Cezane } from "./app";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

async function imageContent(path: string): Promise<Content> {
  return { type: "image", data: Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64"), mimeType: "image/jpeg" };
}

const EDIT_DOC = `Apply a batch of edit ops to the montage (one revision). Frames at montage fps; srcIn in seconds. Ops:
add_clip {track, clip}: clip = {type:"media", assetId, start, duration, srcIn?, speed?, volume?, muted?, fit?:"cover"|"contain", focus?:{x,y}, zoom?:{from,to,x,y,easing:"linear"|"ease"|"punch"}, cutout?:bool (person cut out), box?:{x,y,w,h} (where it is drawn, 0..1; picture-in-picture, or green screen with cutout), outline?:{width,color} (sticker edge of a cutout), grade?:{lut,intensity,vignette} (overrides the montage look; {lut:"none"} keeps the clip raw), opacity?, transitionIn?:{type:"fade"|"whip"|"zoom"|"slide",frames}} | {type:"graphic", component, props, start, duration, behind?:bool} (see graphics tool)
update_clip {id, set} (graphic props are merged; null removes a field/prop, e.g. {props:{zoom:null}}) · move_clip {id, start?, track?} · trim_clip {id, start?, end?} · split_clip {id, at}
remove_clip {id, ripple?} · cut_range {start, end} (every track, closes the gap) · insert_gap {at, frames}
add_track {kind:"video"|"overlay"|"audio", role?:"broll"|"graphics"|"captions"|"music"|"voice"|"sfx", name?, index?} · update_track {track, set:{name,muted,hidden}} · remove_track {track}
set_settings {set:{width,height,fps,background,grade:{lut,intensity?,vignette?}}} (grade = color look of all imported footage; LUTs: drame, film, provence, nuit, pastel, noir, or a .cube in the project luts/ folder; captures and generated images are not graded) · set_audio {set:{targetLufs, voice:"none"|"clean"|"podcast", duck, duckDb}}
Tracks stack bottom→top; refer to them by id or name. Text behind the person: give the graphic behind:true (BigText or Title); it is placed from the person automatically and stays in front on close-ups (head > 35% of the frame). Green screen: use the green_screen tool.`;

/**
 * One MCP server per request (stateless Streamable HTTP). It acts on the reel given as ?reel=<id>
 * (Claude sessions are pinned to the reel they started on), else on the project's selected reel.
 */
export function mcpHandler(app: Cezane) {
  return async (req: Request): Promise<Response> => {
    const server = buildServer(app, new URL(req.url).searchParams.get("reel") ?? undefined);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}

function buildServer(app: Cezane, reelParam?: string): McpServer {
  const s = app.store;
  const reelId = reelParam && s.project.montages.some((m) => m.id === reelParam) ? reelParam : s.activeId;
  const reel = () => s.reel(reelId);
  const server = new McpServer({ name: "cezane", version: "0.1.0" });
  const tmp = (name: string) => {
    const d = s.path(".cezane/tmp");
    mkdirSync(d, { recursive: true });
    return join(d, name);
  };
  const env = () => ({ worker: app.worker, projectDir: s.dir, assets: s.assetMap(), baseUrl: app.baseUrl });

  server.registerTool("overview", { description: "Compact summary: tracks, clips (ids, frames), assets, open comments." }, async () =>
    text(overview(s.project, reel().montage, s.reelComments(reelId), s.reelVersions(reelId), reel().revision)),
  );

  server.registerTool(
    "transcript",
    {
      description: "Timestamped transcript. With assetId: the source (seconds). Without: the montage main track in timeline frames, optionally limited to [from,to).",
      inputSchema: { assetId: z.string().optional(), from: z.number().int().optional(), to: z.number().int().optional() },
    },
    async ({ assetId, from, to }) => {
      if (assetId) {
        const t = s.transcript(assetId);
        return t ? text(`lang=${t.language}\n${transcriptLines(t.words, "s")}`) : fail("no transcript for this asset");
      }
      const words = timelineWords(reel().montage, s.transcript).filter((w) => (from === undefined || w.end > from) && (to === undefined || w.start < to));
      return text(transcriptLines(words, "f", reel().montage.settings.fps) || "(no speech in range)");
    },
  );

  server.registerTool(
    "look",
    {
      description:
        "Render frames of the current montage into ONE labeled image (cheap: always batch frames here). region zooms on a normalized area. compare:'previous' shows each frame before/after the last revision.",
      inputSchema: {
        frames: z.array(z.number().int()).min(1).max(9),
        region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
        compare: z.string().optional().describe("'previous' or a version id like 'v2'"),
      },
    },
    async ({ frames, region, compare }) => {
      const m = reel().montage;
      let other = undefined;
      if (compare) other = compare === "previous" ? reel().montageAt(reel().revision - 1) : s.versionMontage(compare);
      const items: LookItem[] = frames.flatMap((f) =>
        other
          ? [
              { label: `avant f${f}`, frame: f, montage: other, region },
              { label: `après f${f}`, frame: f, region },
            ]
          : [{ label: `f${f}`, frame: f, region }],
      );
      const out = tmp(`look-${newId("l")}.jpg`);
      await app.ensureCutouts(undefined, m);
      await app.ensureGrades(undefined, m);
      await look(m, env(), items, out, other ? 2 : undefined);
      const small = out.replace(/\.jpg$/, ".s.jpg");
      await ffmpeg(["-i", out, "-vf", "scale='min(720,iw)':-2", "-q:v", "5", small]);
      return { content: [await imageContent(small), { type: "text" as const, text: items.map((i) => i.label).join(", ") }] };
    },
  );

  server.registerTool(
    "comment_context",
    { description: "Everything needed to handle review comments in one call: text, thread, where they point now, clip, transcript around, and the user's snapshots (one image).", inputSchema: { ids: z.array(z.string()).min(1) } },
    async ({ ids }) => {
      const lines: string[] = [];
      const snaps: { path: string; region?: { x: number; y: number; w: number; h: number }; pin?: { x: number; y: number } }[] = [];
      const fps = reel().montage.settings.fps;
      for (const id of ids) {
        const c = app.comment(id, reelId);
        if (c.status === "sent") c.status = "in_progress";
        lines.push(`## ${c.id} #${c.n} [${c.status}]`);
        for (const m of c.thread) lines.push(`${m.author}: ${m.text}`);
        const a = c.anchor;
        if (a.kind === "montage") {
          const r = resolveAnchor(a, reel().montage);
          lines.push(`made on ${a.versionId} at f${a.frame}${a.frameEnd ? `-${a.frameEnd}` : ""}; now at f${r.frame}${r.frameEnd ? `-${r.frameEnd}` : ""} (${r.status})`);
          if (a.region) lines.push(`zone x=${a.region.x.toFixed(2)} y=${a.region.y.toFixed(2)} w=${a.region.w.toFixed(2)} h=${a.region.h.toFixed(2)} (normalized)`);
          if (a.pin) lines.push(`pin x=${a.pin.x.toFixed(2)} y=${a.pin.y.toFixed(2)}`);
          const hits = reel().montage.tracks.flatMap((t) => t.clips.filter((cl) => r.frame >= cl.start && r.frame < clipEnd(cl)).map((cl) => `${cl.id}@${t.name}`));
          if (hits.length) lines.push(`clips there: ${hits.join(", ")}`);
          const from = r.frame - 3 * fps;
          const to = (r.frameEnd ?? r.frame) + 3 * fps;
          const words = timelineWords(reel().montage, s.transcript).filter((w) => w.end > from && w.start < to);
          if (words.length) lines.push(`speech: ${transcriptLines(words, "f", fps)}`);
        } else {
          lines.push(`canvas ${a.canvasId}${a.shapeId ? ` shape ${a.shapeId}` : ""}`);
        }
        if (c.snapshot && existsSync(s.path(c.snapshot))) snaps.push({ path: s.path(c.snapshot), region: a.region, pin: a.pin });
      }
      s.saveComments();
      app.changed();
      const content: Content[] = [{ type: "text", text: lines.join("\n") }];
      if (snaps.length) {
        // The user's snapshots side by side, zone outlined in red.
        const out = tmp(`ctx-${newId("x")}.jpg`);
        const inputs = snaps.slice(0, 4).flatMap((x) => ["-i", x.path]);
        const chains = snaps.slice(0, 4).map((x, i) => {
          const box = x.region
            ? `,drawbox=x=iw*${x.region.x}:y=ih*${x.region.y}:w=iw*${x.region.w}:h=ih*${x.region.h}:color=red@0.9:t=6`
            : x.pin
              ? `,drawbox=x=iw*${x.pin.x}-18:y=ih*${x.pin.y}-18:w=36:h=36:color=red@0.9:t=8`
              : "";
          return `[${i}:v]scale=-2:640${box}[s${i}]`;
        });
        const n = Math.min(4, snaps.length);
        const stack = n > 1 ? `;${Array.from({ length: n }, (_, i) => `[s${i}]`).join("")}hstack=inputs=${n}[o]` : "";
        await ffmpeg([...inputs, "-filter_complex", `${chains.join(";")}${stack}`, "-map", n > 1 ? "[o]" : "[s0]", "-frames:v", "1", "-q:v", "5", out]);
        content.push(await imageContent(out));
        content.push({ type: "text", text: `image: snapshots in order ${snaps.length > 4 ? "(first 4)" : ""}` });
      }
      return { content };
    },
  );

  server.registerTool(
    "edit",
    { description: EDIT_DOC, inputSchema: { ops: z.array(z.record(z.string(), z.unknown())).min(1), reason: z.string().optional().describe("one line, shown in the version summary") } },
    async ({ ops, reason }) => {
      try {
        const r = reel().edit(ops as Op[], "claude", reason);
        app.changed();
        return text(`rev ${r.revision}: ${r.summary.join("; ")}`);
      } catch (e) {
        return fail(e instanceof OpError || e instanceof Error ? `rejected, nothing changed: ${e.message}` : String(e));
      }
    },
  );

  server.registerTool(
    "cut_silences",
    {
      description: "Deterministically remove silences (and optionally filler words like 'euh', 'um') from the main track, keeping a small padding.",
      inputSchema: { minSilence: z.number().optional().describe("seconds, default 0.4"), padding: z.number().optional().describe("seconds kept around speech, default 0.1"), fillers: z.boolean().optional(), clipIds: z.array(z.string()).optional() },
    },
    async (o) => {
      const { ops, removedFrames } = cutSilencesOps(reel().montage, s.analysis, s.transcript, o);
      if (!ops.length) return text("nothing to cut");
      const r = reel().edit(ops, "claude", `silences coupés (${(removedFrames / reel().montage.settings.fps).toFixed(1)} s)`);
      app.changed();
      return text(`rev ${r.revision}: ${ops.length} cuts, ${(removedFrames / reel().montage.settings.fps).toFixed(1)}s removed`);
    },
  );

  server.registerTool(
    "captions",
    {
      description:
        "Create word-by-word captions from the transcript of the main track (replaces existing captions). Re-run after cutting. Styles: clean (default: serif, whole page shown, words go from 40% to white as they are said, no color change), native (TikTok Sans with stroke), pill (active word on a pill), box (page on a box, color = box color), caps (all-caps yellow word, dated: only when asked). Pages are one line of 2–4 words; bottom = y 0.65, set y≈0.45 when the lower half holds a screen or a cut-out person.",
      inputSchema: {
        style: z.enum(CAPTION_STYLES).optional(),
        position: z.enum(["top", "center", "bottom"]).optional(),
        y: z.number().min(0.1).max(0.9).optional(),
        color: z.string().optional(),
        wordsPerPage: z.number().int().min(1).max(8).optional(),
      },
    },
    async (o) => {
      const { ops, words } = captionsOps(reel().montage, s.transcript, o);
      if (!words) return fail("no transcribed speech on the main track");
      const r = reel().edit(ops, "claude", `sous-titres ${o.style ?? "clean"}`);
      app.changed();
      return text(`rev ${r.revision}: captions with ${words} words`);
    },
  );

  server.registerTool(
    "green_screen",
    {
      description:
        "Green screen (TikTok explainer + screen): over [start,end) frames, the background assets (images, screenshots, videos) take turns behind the speaker of the main track, cut out and anchored at the bottom (scale = share of the frame, ~0.6). Captions move above the speaker automatically. Change backgrounds every 3–5 s.",
      inputSchema: {
        start: z.number().int().min(0),
        end: z.number().int().min(1),
        backgrounds: z.array(z.string()).min(1),
        scale: z.number().min(0.35).max(1).optional(),
        align: z.enum(["center", "left", "right"]).optional(),
        outline: z.boolean().optional().describe("white sticker edge around the speaker"),
      },
    },
    async (o) => {
      const missing = o.backgrounds.filter((id) => !s.asset(id));
      if (missing.length) return fail(`unknown assets: ${missing.join(", ")}`);
      const r = reel().edit(greenScreenOps(reel().montage, o), "claude", "green screen");
      app.changed();
      return text(`rev ${r.revision}: ${r.summary.join("; ")}`);
    },
  );

  server.registerTool(
    "audio_cleanup",
    {
      description:
        "Voice processing preset, music level and loudness target for the mix (deterministic, ffmpeg). duck: \"bed\" (default) keeps the music constant, bedDb (default 15) dB under the voice; \"sidechain\" ducks it by up to duckDb while the voice speaks (pumps); false leaves it at its clip volumes. Clips on an sfx track skip the voice chain and the ducking.",
      inputSchema: {
        voice: z.enum(["none", "clean", "podcast"]).optional(),
        targetLufs: z.number().optional(),
        duck: z.union([z.enum(["bed", "sidechain"]), z.literal(false)]).optional(),
        bedDb: z.number().optional(),
        duckDb: z.number().optional(),
      },
    },
    async (set) => {
      const r = reel().edit([{ op: "set_audio", set }], "claude", "réglages audio");
      app.changed();
      return text(`rev ${r.revision}: audio ${JSON.stringify(set)}`);
    },
  );

  server.registerTool("graphics", { description: "Catalog of motion-design components usable in graphic clips, with their props." }, async () => {
    const { graphicInfos } = (await import("@cezane/remotion/src/catalog.ts")) as { graphicInfos: () => { name: string; description: string; props: Record<string, string>; defaultDuration: number }[] };
    return text(graphicInfos().map((g) => `${g.name} (${g.defaultDuration}f): ${g.description}\n  props: ${Object.entries(g.props).map(([k, v]) => `${k}: ${v}`).join("; ")}`).join("\n"));
  });

  server.registerTool(
    "import",
    { description: "Import local files (video, image, audio) as assets; ingestion runs in the background (normalize, transcript, analysis).", inputSchema: { paths: z.array(z.string()).min(1), wait: z.boolean().optional() } },
    async ({ paths, wait }) => {
      const assets = await app.importFiles(paths, undefined, { wait });
      return text(assets.map((a) => `${a.id} "${a.name}" ${a.kind} ${a.status}`).join("\n"));
    },
  );

  server.registerTool(
    "capture",
    {
      description: "Capture an app as a new asset (saved in the project's Captures/ folder): a web page in Chrome (screenshot or scrolling recording) or the booted iOS simulator (screenshot or recording). One capture at a time across projects: it may wait.",
      inputSchema: {
        target: z.enum(["web", "ios"]),
        mode: z.enum(["screenshot", "video"]).default("screenshot"),
        url: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        fullPage: z.boolean().optional(),
        seconds: z.number().optional(),
        actions: z.array(z.record(z.string(), z.unknown())).optional().describe("web: [{wait:ms}|{click:sel}|{type:[sel,text]}|{scroll:px,ms?}|{goto:url}|{hover:sel}]"),
        name: z.string().optional().describe("readable file name in Captures/, e.g. 'onboarding-step-1' (default: from the URL)"),
      },
    },
    async (o) => {
      // Queued behind any other capture (all projects share one simulator and one Chrome).
      const job = await app.capture({ ...o, actions: o.actions as never }).catch((e: Error) => ({ status: "error" as const, error: e.message, result: undefined }));
      if (job.status === "error" || !job.result?.assetId) return fail(job.error ?? "capture failed");
      await app.waitIngest(job.result.assetId);
      const a = s.asset(job.result.assetId)!;
      return text(`${a.id} "${a.name}" ${a.kind} ${a.width}x${a.height} → ${a.file}`);
    },
  );

  server.registerTool(
    "generate",
    {
      description: "Generate an asset with an AI provider (codex/imagegen: free image; claude/haiku|sonnet: text; fal/*: paid, asks the user). Waits for the result.",
      inputSchema: { provider: z.string(), model: z.string(), kind: z.enum(["image", "video", "text", "audio"]), prompt: z.string(), inputs: z.array(z.string()).optional().describe("asset ids used as references") },
    },
    async (req) => {
      const job = await app.generate(req, { askPermission: true }).catch((e: Error) => ({ status: "error", error: e.message, result: undefined }) as const);
      if (job.status === "error") return fail(job.error ?? "failed");
      return text(job.result?.assetId ? `asset ${job.result.assetId}` : String(job.result?.text ?? ""));
    },
  );

  server.registerTool(
    "canvas",
    {
      description: "Read the creative canvas (compact list of shapes) or add a note/text/image to it. The user owns the canvas: only add what was asked.",
      inputSchema: { action: z.enum(["read", "add_note", "add_text", "add_image"]), canvasId: z.string().optional(), text: z.string().optional(), assetId: z.string().optional(), x: z.number().optional(), y: z.number().optional() },
    },
    async (o) => {
      const id = o.canvasId ?? s.project.canvases[0]?.id;
      const doc = id ? s.canvas(id) : undefined;
      if (!doc) return fail("no canvas");
      const store = ((doc.snapshot as { document?: { store?: Record<string, Record<string, unknown>> } } | undefined)?.document?.store ?? {}) as Record<string, Record<string, unknown>>;
      if (o.action === "read") {
        const shapes = [...Object.values(store).filter((r) => r.typeName === "shape"), ...doc.pending];
        const lines = shapes.map((r) => {
          const p = (r.props ?? {}) as Record<string, unknown>;
          const meta = (r.meta ?? {}) as Record<string, unknown>;
          const rich = JSON.stringify(p.richText ?? "").match(/"text":"([^"]*)"/g)?.map((x) => x.slice(8, -1)).join(" ") ?? "";
          const t = typeof p.text === "string" ? p.text : typeof p.prompt === "string" ? p.prompt : rich;
          return `${r.id} ${r.type} @${Math.round(Number(r.x))},${Math.round(Number(r.y))}${meta.assetId ? ` asset=${meta.assetId}` : ""}${p.assetId ? ` asset=${p.assetId}` : ""} ${t.slice(0, 80)}`;
        });
        return text(lines.join("\n") || "(empty canvas)");
      }
      // Partial tldraw shapes: the UI creates them with the editor (which fills every default prop).
      const shapeId = `shape:${newId("cl")}`;
      const base = { id: shapeId, typeName: "shape", x: o.x ?? 0, y: o.y ?? 0, meta: { by: "claude" } };
      const rich = (t: string) => ({ type: "doc", content: t.split("\n").map((l) => ({ type: "paragraph", content: l ? [{ type: "text", text: l }] : [] })) });
      let record: Record<string, unknown>;
      if (o.action === "add_note") record = { ...base, type: "note", props: { color: "yellow", font: "sans", size: "s", richText: rich(o.text ?? "") } };
      else if (o.action === "add_text") record = { ...base, type: "text", props: { richText: rich(o.text ?? ""), font: "sans", size: "s", autoSize: false, w: 420 } };
      else {
        const a = o.assetId ? s.asset(o.assetId) : undefined;
        if (!a) return fail("assetId required");
        const gen = a.provenance.type === "generated" ? a.provenance : undefined;
        const kind = a.kind === "audio" ? "audio" : a.kind;
        const h = a.width && a.height ? Math.round((300 * a.height) / a.width) + 96 : 380;
        record = {
          ...base,
          type: "gen-card",
          props: { w: 300, h, kind, prompt: o.text ?? gen?.prompt ?? a.name, provider: gen?.provider ?? "", model: gen?.model ?? "", status: "done", assetId: a.id, versions: [a.id], chosen: 0 },
          meta: { by: "claude", assetId: a.id },
        };
      }
      s.saveCanvas({ ...doc, pending: [...doc.pending, record] });
      app.broadcast({ type: "canvas", canvasId: doc.id, put: [record], remove: [] });
      return text(`added ${shapeId}`);
    },
  );

  server.registerTool("render", { description: "Render a new version now (normally the server does it when you finish).", inputSchema: { summary: z.string() } }, async ({ summary }) => {
    const v = app.renderVersion("claude", summary, [], reelId);
    return text(`rendering V${v.n} (${v.id})`);
  });

  server.registerTool(
    "reply",
    { description: "Reply to a comment thread; status 'fixed' marks it fixed (the user validates), 'in_progress' to ask a question.", inputSchema: { commentId: z.string(), text: z.string(), status: z.enum(["fixed", "in_progress"]).default("fixed") } },
    async ({ commentId, text: t, status }) => {
      const c = app.comment(commentId, reelId);
      c.thread.push({ author: "claude", text: t, at: new Date().toISOString() });
      c.status = status;
      s.saveComments();
      app.changed();
      return text(`${c.id} → ${status}`);
    },
  );

  server.registerTool(
    "approve",
    { description: "Permission prompt (internal).", inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() } },
    async ({ tool_name, input }) => {
      const r = await app.approve(tool_name, input);
      return text(JSON.stringify(r.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: r.message ?? "refused by the user" }));
    },
  );

  void findClip;
  return server;
}
