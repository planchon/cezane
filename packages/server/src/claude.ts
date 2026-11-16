import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeEvent } from "@cezane/core";
import { newId } from "@cezane/core";

export const TOOL_NAMES = [
  "overview",
  "transcript",
  "look",
  "comment_context",
  "edit",
  "cut_silences",
  "green_screen",
  "captions",
  "audio_cleanup",
  "graphics",
  "import",
  "capture",
  "generate",
  "canvas",
  "render",
  "reply",
] as const;

const GUIDE = `You are the editor inside Cezane, a local video editing tool. The project is a declarative montage you change ONLY through the cezane MCP tools; the server renders it.
Rules:
- Start with \`overview\` (ids, frames, open comments). Times are frames at the montage fps (30) unless a field says seconds.
- Comments: call \`comment_context\` once for all the comments you handle, fix them with as few \`edit\` batches as possible, then \`reply\` to each one (status "fixed") explaining briefly what you changed. Never mark a comment validated: only the user does.
- Use deterministic tools when they fit: cut_silences, captions, audio_cleanup. Use \`transcript\` with a frame range instead of reading whole transcripts.
- Check visual changes with ONE \`look\` call (several frames in one image, or compare:"previous"); don't look at every step. Do not call \`render\`: the server renders a new version when you finish, unless the user asked for a render.
- Be token-frugal: short tool inputs, short replies, no recap of the whole project at the end — two sentences max.
- Answer the user in the language of their comments (usually French).
Style (TikTok codes, 1080x1920):
- Keep text inside x 60–960 and y 250–1340: the TikTok UI covers the top, the bottom ~30% and the right rail.
- Hook in the first 1–3 s: Title style "native" at y≈0.3, 4–12 words, sentence case, at most one emoji at the end, held until the next text beat.
- Captions: style "clean" (default), one line of 2–4 words. Never emoji in captions, no per-word sound effects, no more than two colors. "caps" (all caps, yellow word) only when asked.
- Text behind the person: BigText or Title with behind:true, 1–3 s, on medium shots; on close-ups it stays in front.
- Green screen: green_screen tool, background change every 3–5 s.
- Color: a montage grade (set_settings grade) gives footage a look; "drame" for dramatic, "film" for soft, "provence" for warm. Text and graphics are never graded.
- Screenshots for docs/onboarding/help: ScreenshotShowcase with label + caption + muted, a Figma cursor on what to click, a loupe on small details.`;

/** mcpUrl: the project's MCP endpoint (http://127.0.0.1:<port>/api/p/<projectId>/mcp). */
type Opts = { dir: string; mcpUrl: string; model: string; onEvent: (e: ClaudeEvent) => void; onEnd: (ok: boolean) => void };

const short = (v: unknown, n = 300) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** Runs Claude Code headless on the subscription, with only the Cezane tools, and relays its activity. */
export class ClaudeRunner {
  proc?: ReturnType<typeof Bun.spawn>;
  events: ClaudeEvent[] = [];
  task?: string;
  startedAt?: string;
  private toolNames = new Map<string, string>();

  constructor(private o: Opts) {}

  get running() {
    return Boolean(this.proc && this.proc.exitCode === null);
  }

  private emit(e: Omit<ClaudeEvent, "id" | "at">) {
    const ev: ClaudeEvent = { id: newId("e"), at: new Date().toISOString(), ...e };
    this.events.push(ev);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    this.o.onEvent(ev);
  }

  start(prompt: string, task: string, model = this.o.model) {
    if (this.running) throw new Error("Claude is already working");
    const cfg = join(this.o.dir, ".cezane/mcp.json");
    writeFileSync(cfg, JSON.stringify({ mcpServers: { cezane: { type: "http", url: this.o.mcpUrl } } }));
    const args = [
      "claude",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      model,
      "--mcp-config",
      cfg,
      "--strict-mcp-config",
      "--permission-prompt-tool",
      "mcp__cezane__approve",
      "--allowedTools",
      TOOL_NAMES.map((t) => `mcp__cezane__${t}`).join(","),
      "--append-system-prompt",
      GUIDE,
      prompt,
    ];
    this.events = [];
    this.task = task;
    this.startedAt = new Date().toISOString();
    this.emit({ kind: "start", text: task });
    // Tool search would defer the Cezane tools and cost extra turns: load them upfront.
    const proc = Bun.spawn(args, { cwd: this.o.dir, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, ENABLE_TOOL_SEARCH: "false" } });
    this.proc = proc;
    void this.read(proc.stdout as ReadableStream<Uint8Array>);
    void (async () => {
      const err = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
      const code = await proc.exited;
      if (code !== 0) this.emit({ kind: "error", text: err.trim().slice(-500) || `claude exited with ${code}` });
      this.o.onEnd(code === 0);
    })();
  }

  stop() {
    this.proc?.kill();
  }

  private async read(stream: ReadableStream<Uint8Array>) {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of stream) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.onLine(line);
      }
    }
  }

  private onLine(line: string) {
    let msg: { type: string; subtype?: string; message?: { content?: unknown }; result?: string; total_cost_usd?: number; is_error?: boolean };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const c of msg.message.content as { type: string; id?: string; text?: string; name?: string; input?: unknown }[]) {
        if (c.type === "text" && c.text?.trim()) this.emit({ kind: "text", text: c.text.trim() });
        if (c.type === "tool_use") {
          const tool = (c.name ?? "").replace(/^mcp__cezane__/, "");
          if (c.id) this.toolNames.set(c.id, tool);
          this.emit({ kind: "tool", tool, input: c.input });
        }
      }
    } else if (msg.type === "user" && Array.isArray(msg.message?.content)) {
      for (const c of msg.message.content as { type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }[]) {
        if (c.type !== "tool_result") continue;
        const text = Array.isArray(c.content)
          ? (c.content as { type: string; text?: string }[]).map((x) => (x.type === "text" ? x.text : `[${x.type}]`)).join(" ")
          : short(c.content);
        this.emit({ kind: "tool_result", tool: c.tool_use_id ? this.toolNames.get(c.tool_use_id) : undefined, ok: !c.is_error, text: short(text, 400) });
      }
    } else if (msg.type === "result") {
      this.emit({ kind: "end", ok: !msg.is_error, text: msg.result ? short(msg.result, 1200) : undefined, costUsd: msg.total_cost_usd });
    }
  }
}
