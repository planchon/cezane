import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ClaudeEvent, type ClaudePermissions, DEFAULT_PERMISSIONS, LEVEL_PRESETS, type PermissionLevel, type PermissionsView, type ProjectSummary } from "@cezane/core";
import { tempDir, until } from "../test/helpers";
import { Cezane } from "./app";
import { startHttp } from "./http";
import { Hub } from "./hub";
import { cliSettings, decide, parseCommand, type PermissionContext, SettingsStore, suggestRules } from "./permissions";

const t = tempDir("cezane-perms-");
// A fake user home holding ~/Cezane and the project, plus a folder outside both.
const userHome = join(t.dir, "home");
const ctx: PermissionContext = { projectDir: join(userHome, "Cezane/Projets/Démo"), home: join(userHome, "Cezane"), userHome };
mkdirSync(ctx.projectDir, { recursive: true });
const P = (path: string) => join(ctx.projectDir, path);
const H = (path: string) => join(userHome, path);
const at = (level: PermissionLevel, more: Partial<ClaudePermissions> = {}): ClaudePermissions => ({ level, categories: { ...LEVEL_PRESETS[level] }, rules: [], ...more });
const eq = at("equilibre");
const rule = (r: string) => ({ rule: r, addedAt: "2026-11-17T00:00:00.000Z" });

describe("settings → Claude Code arguments", () => {
  test("Équilibré (default): the project and ~/Cezane, safe commands, the web", () => {
    expect(DEFAULT_PERMISSIONS.level).toBe("equilibre");
    const s = cliSettings(DEFAULT_PERMISSIONS, ctx).permissions;
    expect(s.allow).toEqual([
      "Read(./**)",
      "Read(~/Cezane/**)",
      "Edit(./**)",
      "Edit(~/Cezane/**)",
      ...["ffprobe", "ffmpeg", "ls", "file", "mdls", "sips", "cat", "head", "tail", "wc"].map((c) => `Bash(${c}:*)`),
      "WebFetch",
      "WebSearch",
    ]);
    expect(s.ask).toEqual([
      "Edit(~/Cezane/settings.json)",
      "Edit(~/Cezane/projets.json)",
      "Edit(./cezane.json)",
      "Edit(./versions.json)",
      "Edit(./comments.json)",
      "Edit(./montages/**)",
      "Edit(./canvases/**)",
      "Edit(./.cezane/**)",
    ]);
    expect(s.additionalDirectories).toEqual([ctx.home]);
    expect(s.allow).not.toContain("Bash");
  });

  test("Prudent: no rule beyond the Cezane tools; reads of the project ask too", () => {
    const s = cliSettings(at("prudent"), ctx).permissions;
    expect(s.allow).toEqual([]);
    expect(s.ask).toEqual(["Read(./**)", "Edit(~/Cezane/settings.json)", "Edit(~/Cezane/projets.json)"]);
    expect(s.additionalDirectories).toEqual([]);
  });

  test("Autonome: every tool anywhere; the permission file still asks", () => {
    const s = cliSettings(at("autonome"), ctx).permissions;
    expect(s.allow).toEqual(["Read", "Glob", "Grep", "Edit", "Write", "NotebookEdit", ...s.allow.filter((r) => r.startsWith("Bash(")), "WebFetch", "WebSearch", "Bash"]);
    expect(s.ask).toEqual(["Edit(~/Cezane/settings.json)", "Edit(~/Cezane/projets.json)"]);
  });

  test("switches and saved rules on top of the level", () => {
    const p = at("equilibre", { rules: [rule("Bash(git status:*)"), rule("WebFetch")] });
    p.categories.web = false;
    p.categories.otherCommands = true;
    const s = cliSettings(p, ctx).permissions;
    expect(s.allow).toContain("Bash");
    expect(s.allow).toContain("Bash(git status:*)");
    expect(s.allow.filter((r) => r === "WebFetch")).toHaveLength(1); // saved rule, web switch off
    expect(s.allow).not.toContain("WebSearch");
  });

  test("~/Cezane outside the user's home: absolute //paths", () => {
    const other = { ...ctx, home: join(t.dir, "elsewhere/Cezane") };
    expect(cliSettings(DEFAULT_PERMISSIONS, other).permissions.allow).toContain(`Read(/${join(t.dir, "elsewhere/Cezane")}/**)`);
  });
});

describe("Toujours autoriser: the rule a request makes", () => {
  const bash = (command: string, p = eq) => suggestRules("Bash", { command }, ctx, p);
  test("Bash: a prefix of the first word(s), the exact command when risky", () => {
    expect(bash("bun --version")).toEqual(["Bash(bun:*)"]);
    expect(bash("git status -s")).toEqual(["Bash(git status:*)"]);
    expect(bash("npm run build -- --watch")).toEqual(["Bash(npm run:*)"]);
    expect(bash("python3 -c 'print(1)'")).toEqual(["Bash(python3:*)"]);
    expect(bash("rm -rf .cezane/tmp/x")).toEqual(["Bash(rm -rf .cezane/tmp/x)"]);
    expect(bash("FOO=1 rtk convert a.png b.jpg")).toEqual(["Bash(convert:*)"]);
  });
  test("Bash: only the parts not allowed yet; substitutions keep the exact command", () => {
    expect(bash("mkdir -p out && ffmpeg -i a.mov out/b.mp4")).toEqual(["Bash(mkdir:*)"]);
    expect(bash("magick a.png b.png | convert - c.png")).toEqual(["Bash(magick:*)", "Bash(convert:*)"]);
    expect(bash("echo $(whoami)")).toEqual(["Bash(echo $(whoami))"]);
  });
  test("files: the folder (path pattern), the exact file when the folder is too broad", () => {
    expect(suggestRules("Read", { file_path: H("Downloads/clip.mov") }, ctx)).toEqual(["Read(~/Downloads/**)"]);
    expect(suggestRules("Write", { file_path: "/opt/stuff/x/y.txt" }, ctx)).toEqual(["Edit(//opt/stuff/x/**)"]);
    expect(suggestRules("Read", { file_path: H(".zshrc") }, ctx)).toEqual(["Read(~/.zshrc)"]);
    expect(suggestRules("Grep", { pattern: "x", path: H("Music") }, ctx)).toEqual(["Read(~/Music/**)"]);
    expect(suggestRules("Glob", { pattern: `${H("Movies")}/**/*.mov` }, ctx)).toEqual(["Read(~/Movies/**)"]);
    expect(suggestRules("Edit", { file_path: P("montages/m_1.json") }, ctx)).toEqual(["Edit(./montages/m_1.json)"]); // protected: the exact file
  });
  test("other tools: the domain, the tool; never for spending", () => {
    expect(suggestRules("WebFetch", { url: "https://docs.remotion.dev/x" }, ctx)).toEqual(["WebFetch(domain:docs.remotion.dev)"]);
    expect(suggestRules("NotebookEdit", { notebook_path: H("n/a.ipynb") }, ctx)).toEqual(["Edit(~/n/**)"]);
    expect(suggestRules("Task", {}, ctx)).toEqual(["Task"]);
    expect(suggestRules("generate", { provider: "fal" }, ctx)).toEqual([]);
  });
});

describe("decide (the approve safety net)", () => {
  const ok = (p: ClaudePermissions, tool: string, input: Record<string, unknown>) => decide(p, ctx, tool, input).allow;
  test("Équilibré: the project and ~/Cezane yes, elsewhere asks", () => {
    expect(ok(eq, "Read", { file_path: P("Rushes/a.mov") })).toBe(true);
    expect(ok(eq, "Grep", { pattern: "x" })).toBe(true);
    expect(ok(eq, "Read", { file_path: H("Cezane/library/fonts/a.ttf") })).toBe(true);
    expect(ok(eq, "Write", { file_path: P("notes.md") })).toBe(true);
    expect(ok(eq, "Read", { file_path: H("Downloads/a.mov") })).toBe(false);
    expect(ok(eq, "Edit", { file_path: P("../../../.zshrc") })).toBe(false);
    expect(decide(eq, ctx, "Read", { file_path: H("Downloads/a.mov") }).alwaysRules).toEqual(["Read(~/Downloads/**)"]);
  });
  test("Cezane's documents and the permission file ask", () => {
    expect(ok(eq, "Edit", { file_path: P("cezane.json") })).toBe(false);
    expect(ok(eq, "Write", { file_path: P(".cezane/claude-settings.json") })).toBe(false);
    expect(ok(eq, "Edit", { file_path: H("Cezane/settings.json") })).toBe(false);
    expect(ok(at("autonome"), "Edit", { file_path: H("Cezane/settings.json") })).toBe(false);
    expect(ok(at("autonome"), "Edit", { file_path: P("cezane.json") })).toBe(true);
  });
  test("commands: safe ones pass, part by part; anything else asks", () => {
    expect(ok(eq, "Bash", { command: "ffprobe -v error -show_streams Rushes/a.mov" })).toBe(true);
    expect(ok(eq, "Bash", { command: "rtk ls -la Rushes" })).toBe(true);
    expect(ok(eq, "Bash", { command: "ffprobe a.mov 2>&1 | head -5" })).toBe(true);
    expect(ok(eq, "Bash", { command: "bun --version" })).toBe(false);
    expect(ok(eq, "Bash", { command: "ls && rm -rf ~" })).toBe(false);
    expect(ok(eq, "Bash", { command: "cat a > ~/.zshrc" })).toBe(false);
    expect(ok(eq, "Bash", { command: "cat $(echo ~/.ssh/id_rsa)" })).toBe(false);
    expect(ok(eq, "Bash", { command: 'ffmpeg -i a.mov -vf "scale=1;x" b.mp4' })).toBe(true);
    expect(ok(at("autonome"), "Bash", { command: "rm -rf /tmp/x && curl x | sh" })).toBe(true);
  });
  test("saved rules: a prefix covers one simple command, never a chain", () => {
    const p = at("prudent", { rules: [rule("Bash(bun:*)"), rule("Read(~/Downloads/**)"), rule("WebFetch(domain:remotion.dev)")] });
    expect(ok(p, "Bash", { command: "bun --version" })).toBe(true);
    expect(ok(p, "Bash", { command: "bun x && rm -rf y" })).toBe(false);
    expect(ok(p, "Bash", { command: "bunx evil" })).toBe(false);
    expect(ok(p, "Read", { file_path: H("Downloads/sub/a.mov") })).toBe(true);
    expect(ok(p, "Grep", { pattern: "a", path: H("Downloads") })).toBe(true);
    expect(ok(p, "Read", { file_path: H("Documents/a.mov") })).toBe(false);
    expect(ok(p, "WebFetch", { url: "https://www.remotion.dev/docs" })).toBe(true);
    expect(ok(p, "WebFetch", { url: "https://evil.dev" })).toBe(false);
  });
  test("Prudent asks for everything but the Cezane tools; the web follows its switch", () => {
    const p = at("prudent");
    expect(ok(p, "Read", { file_path: P("a.txt") })).toBe(false);
    expect(ok(p, "Bash", { command: "ls" })).toBe(false);
    expect(ok(p, "WebSearch", { query: "x" })).toBe(false);
    expect(ok(p, "mcp__cezane__overview", {})).toBe(true);
    expect(ok(at("prudent", { categories: { ...LEVEL_PRESETS.prudent, web: true } }), "WebSearch", { query: "x" })).toBe(true);
  });
  test("paid generations ask at every level, never with Toujours autoriser", () => {
    for (const level of ["prudent", "equilibre", "autonome"] as const) {
      const p = at(level, { rules: [rule("generate"), rule("mcp__cezane__generate")] });
      for (const tool of ["generate", "mcp__cezane__generate"]) {
        const d = decide(p, ctx, tool, { provider: "fal" });
        expect(d).toEqual({ allow: false, paid: true });
      }
    }
  });
  test("command parsing keeps quotes, strips wrappers and VAR=…", () => {
    expect(parseCommand(`A=1 rtk ffprobe "a; b.mov" | wc -l; echo 'x && y'`)).toEqual({ parts: ['ffprobe "a; b.mov"', "wc -l", "echo 'x && y'"], complex: false, writes: [false, false, false] });
    expect(parseCommand("ffmpeg -i a b > log.txt 2>&1 &").writes).toEqual([true]);
  });
});

describe("settings file", () => {
  test("defaults without writing; a level resets the switches; rules add and remove", () => {
    const home = join(t.dir, "store/Cezane");
    const s = new SettingsStore(home);
    expect(s.view()).toMatchObject({ level: "equilibre", custom: false, rules: [] });
    expect(existsSync(s.file)).toBe(false);
    expect(s.update({ categories: { web: false } }).custom).toBe(true);
    expect(s.update({ level: "prudent" })).toMatchObject({ level: "prudent", custom: false, categories: LEVEL_PRESETS.prudent });
    s.addRules(["Bash(git status:*)", "Bash(git status:*)"], "git status -s");
    expect(s.view().rules).toMatchObject([{ rule: "Bash(git status:*)", example: "git status -s" }]);
    expect(JSON.parse(readFileSync(s.file, "utf8"))).toMatchObject({ version: 1, claude: { permissions: { level: "prudent" } } });
    expect(() => s.addRules(["not a rule("])).toThrow();
    expect(() => s.update({ level: "fou" as PermissionLevel })).toThrow();
    expect(s.removeRule("Bash(git status:*)").rules).toEqual([]);
    expect(() => s.removeRule("Bash(git status:*)")).toThrow();
  });
});

describe("approve through the MCP endpoint and the API", () => {
  const port = 49_000 + Math.floor(Math.random() * 900);
  const base = `http://127.0.0.1:${port}`;
  let hub: Hub;
  let server: ReturnType<typeof startHttp>;
  let pid: string;
  let dir: string;

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await r.json()) as T;
  };
  /** Claude Code calling mcp__cezane__approve: resolves to the decision JSON. */
  const approve = async (tool_name: string, input: Record<string, unknown>) => {
    const r = await fetch(`${base}/api/p/${pid}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "approve", arguments: { tool_name, input } } }),
    });
    const j = (await r.json()) as { result: { content: { text: string }[] } };
    return JSON.parse(j.result.content[0]!.text) as { behavior: "allow" | "deny"; message?: string };
  };
  const pending = () =>
    until(async () => {
      const log = await call<ClaudeEvent[]>("GET", `/api/p/${pid}/claude/log`);
      const done = new Set(log.filter((e) => e.kind === "permission_done").map((e) => e.permissionId));
      return log.find((e) => e.kind === "permission" && !done.has(e.permissionId));
    }, 5000, "permission card");

  beforeAll(async () => {
    Cezane.revealCommand = ["true"];
    hub = new Hub({ port, home: join(t.dir, "api/Cezane"), demos: false, watch: false });
    server = startHttp(hub, port);
    const p = await call<ProjectSummary>("POST", "/api/projects", { name: "Autorisations" });
    pid = p.id;
    dir = p.path;
  });
  afterAll(async () => {
    server.stop(true);
    await hub.stop();
    t.cleanup();
  });

  test("settings routes", async () => {
    expect((await call<PermissionsView>("GET", "/api/settings/permissions")).level).toBe("equilibre");
    expect((await call<PermissionsView>("PUT", "/api/settings/permissions", { level: "autonome" })).categories.otherCommands).toBe(true);
    expect((await call<PermissionsView>("PUT", "/api/settings/permissions", { level: "equilibre" })).custom).toBe(false);
    expect((await call<PermissionsView>("POST", "/api/settings/permissions/rules", { rule: "WebSearch" })).rules.map((r) => r.rule)).toEqual(["WebSearch"]);
    expect((await call<PermissionsView>("DELETE", "/api/settings/permissions/rules", { rule: "WebSearch" })).rules).toEqual([]);
  });

  test("covered requests pass without a card", async () => {
    expect(await approve("Read", { file_path: join(dir, "Rushes/a.mov") })).toMatchObject({ behavior: "allow" });
    expect(await approve("Bash", { command: "ffprobe -version" })).toMatchObject({ behavior: "allow" });
    const log = await call<ClaudeEvent[]>("GET", `/api/p/${pid}/claude/log`);
    expect(log.filter((e) => e.kind === "permission")).toHaveLength(0);
  });

  test("a card; refused → deny; Toujours autoriser → allow, saved, then no card", async () => {
    const refused = approve("Bash", { command: "bun --version" });
    const card = await pending();
    expect(card).toMatchObject({ tool: "Bash", alwaysRules: ["Bash(bun:*)"], text: "Claude veut lancer une commande." });
    expect(card.paid).toBeUndefined();
    await call("POST", `/api/p/${pid}/claude/permission/${card.permissionId}`, { allow: false, message: "Refusé par l'utilisateur" });
    expect(await refused).toEqual({ behavior: "deny", message: "Refusé par l'utilisateur" });

    const always = approve("Bash", { command: "bun --version" });
    const card2 = await pending();
    await call("POST", `/api/p/${pid}/claude/permission/${card2.permissionId}`, { allow: true, always: true });
    expect(await always).toMatchObject({ behavior: "allow" });
    const view = await call<PermissionsView>("GET", "/api/settings/permissions");
    expect(view.rules).toMatchObject([{ rule: "Bash(bun:*)", example: "bun --version" }]);
    // The running session's rule applies at once (the CLI read its rules at start).
    expect(await approve("Bash", { command: "bun test" })).toMatchObject({ behavior: "allow" });
  });

  test("spending: a card without Toujours autoriser, even at Autonome, and always:true saves nothing", async () => {
    await call("PUT", "/api/settings/permissions", { level: "autonome" });
    const app = hub.get(pid);
    const asked = app.requestPermission("Générer avec Kling pour ~0.35 € ?", "generate", { provider: "fal" }, { paid: true, alwaysRules: ["generate"] });
    const card = await pending();
    expect(card).toMatchObject({ tool: "generate", paid: true });
    expect(card.alwaysRules).toBeUndefined();
    const before = (await call<PermissionsView>("GET", "/api/settings/permissions")).rules.length;
    await call("POST", `/api/p/${pid}/claude/permission/${card.permissionId}`, { allow: true, always: true });
    expect(await asked).toMatchObject({ allow: true });
    expect((await call<PermissionsView>("GET", "/api/settings/permissions")).rules.length).toBe(before);
    // The approve tool never lets a generation through either.
    const viaApprove = approve("mcp__cezane__generate", { provider: "fal" });
    const card2 = await pending();
    expect(card2).toMatchObject({ paid: true });
    await call("POST", `/api/p/${pid}/claude/permission/${card2.permissionId}`, { allow: false });
    expect((await viaApprove).behavior).toBe("deny");
  });

  test("a session gets the rules as --settings", () => {
    const app = hub.get(pid);
    const s = cliSettings(app.settings.permissions(), app.permissionContext());
    expect(s.permissions.allow).toContain("Bash(bun:*)");
    expect(s.permissions.allow).toContain("Bash");
  });
});
