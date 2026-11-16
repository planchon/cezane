import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type ClaudePermissions,
  DEFAULT_PERMISSIONS,
  isCustomPermissions,
  LEVEL_PRESETS,
  PERMISSION_CATEGORIES,
  PERMISSION_LEVELS,
  type PermissionCategory,
  type PermissionLevel,
  type PermissionsPatch,
  type PermissionsView,
  SAFE_COMMANDS,
} from "@cezane/core";
import { CEZANE_HOME } from "@cezane/engine";
import { writeAtomic } from "./layout";

/**
 * What Claude may do in Cezane without asking (archi/autorisations.md).
 * The settings become Claude Code rules when a session starts (`--settings`, see cliSettings), and
 * the `approve` MCP tool applies the same logic (decide) to whatever Claude Code still asks about,
 * so the behaviour does not rest on the CLI's rule parsing alone, and rules added mid-session
 * with "Toujours autoriser" apply at once. Paid generations always ask.
 */

/** Where a decision is made: the project folder (Claude's cwd), ~/Cezane, the user's home. */
export type PermissionContext = { projectDir: string; home: string; userHome: string };

export type Decision = {
  allow: boolean;
  paid?: boolean; // spends money: always asks, never "toujours"
  alwaysRules?: string[]; // what "Toujours autoriser" adds (asked requests only)
  why?: string; // what allowed it (logs)
};

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const PAID_TOOLS = new Set(["generate", "mcp__cezane__generate"]);
/** Commands whose first two words make the rule: `git status`, `npm run`… */
const TWO_WORDS = new Set(["git", "npm", "npx", "bun", "bunx", "pnpm", "yarn", "brew", "docker", "cargo", "gh", "pip", "pip3", "uv", "go", "swift", "xcrun", "defaults", "osascript"]);
/** Commands too risky for a prefix rule: "Toujours autoriser" saves the exact command. */
const EXACT_ONLY = new Set(["rm", "rmdir", "mv", "sudo", "su", "dd", "chmod", "chown", "kill", "killall", "pkill", "launchctl", "diskutil", "shutdown", "reboot"]);
/** Output-filtering proxies that wrap a command (`rtk ls -la` is `ls -la`). */
const WRAPPERS = new Set(["rtk"]);

// ───────────────────────── paths ─────────────────────────

const nfc = (s: string) => s.normalize("NFC");

/** Absolute path with symlinks resolved on its longest existing prefix (/tmp = /private/tmp), NFC. */
export function realish(p: string): string {
  const abs = resolve(p);
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return nfc(join(realpathSync(cur), ...rest));
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return nfc(abs);
      rest.unshift(basename(cur));
      cur = parent;
    }
  }
}

const inside = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** A path as Claude gave it (absolute, ~/…, or relative to the project) → real absolute path. */
function absPath(p: string, ctx: PermissionContext): string {
  if (p === "~") return realish(ctx.userHome);
  if (p.startsWith("~/")) return realish(join(ctx.userHome, p.slice(2)));
  return realish(isAbsolute(p) ? p : join(ctx.projectDir, p));
}

/** An absolute path in Claude Code's rule syntax: `./x` in the project, `~/x` under the home, `//abs` elsewhere. */
export function rulePath(abs: string, ctx: PermissionContext): string {
  const project = realish(ctx.projectDir);
  const home = realish(ctx.userHome);
  const rel = (from: string) => relative(from, abs).split(sep).join("/");
  if (inside(abs, project)) return abs === project ? "." : `./${rel(project)}`;
  if (inside(abs, home)) return abs === home ? "~" : `~/${rel(home)}`;
  return `/${abs}`;
}

/** A rule's path pattern → absolute glob (`./` and `/` = project, `~/` = home, `//` = filesystem root). */
function patternAbs(spec: string, ctx: PermissionContext): string {
  let abs: string;
  if (spec.startsWith("//")) abs = spec.slice(1);
  else if (spec === "~" || spec.startsWith("~/")) abs = `${ctx.userHome}${spec.slice(1)}`;
  else if (spec.startsWith("/")) abs = `${ctx.projectDir}${spec}`;
  else abs = `${ctx.projectDir}/${spec.replace(/^\.\/?/, "")}`;
  // Resolve the static part (symlinks, /tmp) and keep the glob part as written.
  const segs = abs.split("/");
  const g = segs.findIndex((s) => /[*?[]/.test(s));
  const fixed = g < 0 ? segs.join("/") : segs.slice(0, g).join("/") || "/";
  const tail = g < 0 ? "" : segs.slice(g).join("/");
  const base = realish(fixed);
  return tail ? `${base === "/" ? "" : base}/${tail}` : base;
}

function globRe(pat: string): RegExp {
  let re = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i]!;
    if (c === "*" && pat[i + 1] === "*") {
      i++;
      if (pat[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function pathMatches(spec: string, abs: string, ctx: PermissionContext): boolean {
  const pat = patternAbs(spec, ctx);
  if (pat.endsWith("/**") && abs === pat.slice(0, -3)) return true; // dir/** covers dir itself
  return globRe(pat).test(abs);
}

/** The path a file tool acts on (absolute, real). Search tools without a path act on the project. */
export function toolPath(tool: string, input: Record<string, unknown>, ctx: PermissionContext): { path: string; dir: boolean } {
  const s = (k: string) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string).trim() : undefined);
  const file = s("file_path") ?? s("notebook_path");
  if (file) return { path: absPath(file, ctx), dir: false };
  let p = s("path");
  // Glob with an absolute pattern: its static prefix is where it looks.
  const pattern = s("pattern");
  if (!p && tool === "Glob" && pattern && (pattern.startsWith("/") || pattern.startsWith("~"))) {
    const segs = pattern.split("/");
    const g = segs.findIndex((x) => /[*?[{]/.test(x));
    p = (g < 0 ? segs.slice(0, -1) : segs.slice(0, g)).join("/") || "/";
  }
  if (!p) return { path: realish(ctx.projectDir), dir: true };
  const abs = absPath(p, ctx);
  const isFile = existsSync(abs) && statSync(abs).isFile();
  return { path: abs, dir: !isFile };
}

// ───────────────────────── shell commands ─────────────────────────

export type ShellCommand = {
  parts: string[]; // simple commands, wrappers and VAR=… removed: "ffprobe -v error x.mov"
  complex: boolean; // $(…), `…`, <(…): can't be judged part by part
  writes: boolean[]; // per part: redirects output into a file (other than /dev/null)
};

/** Splits a shell command line on ; && || | & and newlines, outside quotes. */
export function parseCommand(cmd: string): ShellCommand {
  const raw: string[] = [];
  let cur = "";
  let q: "'" | '"' | undefined;
  let complex = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    const n = cmd[i + 1];
    if (q) {
      if (c === q) q = undefined;
      else if (q === '"' && (c === "`" || (c === "$" && n === "("))) complex = true;
      else if (q === '"' && c === "\\" && n !== undefined) {
        cur += c + n;
        i++;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      cur += c;
      continue;
    }
    if (c === "\\" && n !== undefined) {
      cur += c + n;
      i++;
      continue;
    }
    if (c === "`" || (c === "$" && n === "(") || ((c === "<" || c === ">") && n === "(")) complex = true;
    const prev = cmd[i - 1];
    const split = c === "\n" || c === ";" || c === "|" || (c === "&" && prev !== ">" && n !== ">");
    if (split) {
      raw.push(cur);
      cur = "";
      if ((c === "&" && n === "&") || (c === "|" && (n === "|" || n === "&"))) i++;
      continue;
    }
    cur += c;
  }
  raw.push(cur);
  const parts: string[] = [];
  const writes: boolean[] = [];
  for (const r of raw) {
    let p = r.trim();
    if (!p) continue;
    p = p.replace(/^(?:[A-Za-z_]\w*=(?:'[^']*'|"[^"]*"|\S*)\s+)+/, "");
    const first = p.split(/\s+/)[0]!;
    if (WRAPPERS.has(first)) p = p.slice(first.length).trim();
    if (!p) continue;
    parts.push(p);
    const bare = p.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
    writes.push([...bare.matchAll(/\d*>>?\s*(\S+)/g)].some((m) => !m[1]!.startsWith("&") && m[1] !== "/dev/null"));
  }
  return { parts, complex, writes };
}

const bashSpecMatches = (spec: string, part: string) => {
  const s = spec.trim();
  if (s.endsWith(":*")) {
    const prefix = s.slice(0, -2).trim();
    return part === prefix || part.startsWith(`${prefix} `);
  }
  if (s.includes("*")) return new RegExp(`^${s.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(part);
  return part === s;
};

// ───────────────────────── rules ─────────────────────────

/** `Bash(git status:*)` → { tool: "Bash", spec: "git status:*" }. */
export function parseRule(rule: string): { tool: string; spec?: string } | undefined {
  const m = /^([A-Za-z_][\w-]*)(?:\(([\s\S]*)\))?$/.exec(rule.trim());
  if (!m) return undefined;
  return { tool: m[1]!, spec: m[2] !== undefined && m[2] !== "*" && m[2] !== "" ? m[2] : undefined };
}

/**
 * True when `rule` allows this one request. Bash: the whole command, or one part of it (`part`,
 * `writes`: that part redirects into a file). A prefix rule covers one simple command, never
 * `ffprobe x && rm y` nor a redirection into a file; an exact rule covers exactly its command.
 */
export function ruleMatches(rule: string, tool: string, input: Record<string, unknown>, ctx: PermissionContext, part?: string, writes = false): boolean {
  const r = parseRule(rule);
  if (!r) return false;
  const family = READ_TOOLS.has(r.tool) ? READ_TOOLS : EDIT_TOOLS.has(r.tool) ? EDIT_TOOLS : undefined;
  const sameTool = r.tool === tool || (family?.has(tool) ?? false) || (r.tool.startsWith("mcp__") && tool.startsWith(`${r.tool}__`));
  if (!sameTool) return false;
  if (r.spec === undefined) return true;
  if (tool === "Bash") {
    const exact = !r.spec.includes("*");
    if (part !== undefined) return exact ? part === r.spec.trim() : !writes && bashSpecMatches(r.spec, part);
    const cmd = String(input.command ?? "").trim();
    if (exact) return cmd === r.spec.trim();
    const sh = parseCommand(cmd);
    return !sh.complex && sh.parts.length === 1 && !sh.writes[0] && bashSpecMatches(r.spec, sh.parts[0]!);
  }
  if (family) return pathMatches(r.spec, toolPath(tool, input, ctx).path, ctx);
  if (tool === "WebFetch" && r.spec.startsWith("domain:")) {
    const host = hostOf(input.url);
    const d = r.spec.slice(7).trim().toLowerCase();
    return Boolean(host && (host === d || host.endsWith(`.${d}`)));
  }
  return false;
}

const hostOf = (url: unknown) => {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const internalFiles = (ctx: PermissionContext) => {
  const p = realish(ctx.projectDir);
  return { files: ["cezane.json", "versions.json", "comments.json"].map((f) => join(p, f)), dirs: ["montages", "canvases", ".cezane"].map((d) => join(p, d)) };
};
const settingsFiles = (ctx: PermissionContext) => ["settings.json", "projets.json"].map((f) => join(realish(ctx.home), f));

/** Files Claude must not change without asking: its own permissions (always), and Cezane's project documents (it edits the montage through the Cezane tools). */
function isProtected(abs: string, p: ClaudePermissions, ctx: PermissionContext): boolean {
  if (settingsFiles(ctx).includes(abs)) return true;
  if (p.level === "autonome") return false;
  const { files, dirs } = internalFiles(ctx);
  return files.includes(abs) || dirs.some((d) => inside(abs, d));
}

const inScope = (abs: string, ctx: PermissionContext) => inside(abs, realish(ctx.projectDir)) || inside(abs, realish(ctx.home));

/** The rule(s) "Toujours autoriser" adds for a request, scoped sensibly. None for spending. */
export function suggestRules(tool: string, input: Record<string, unknown>, ctx: PermissionContext, p: ClaudePermissions = DEFAULT_PERMISSIONS): string[] {
  if (PAID_TOOLS.has(tool)) return [];
  if (tool === "Bash") {
    const cmd = String(input.command ?? "").trim();
    const sh = parseCommand(cmd);
    if (sh.complex || !sh.parts.length) return [`Bash(${cmd})`];
    const todo = sh.parts.filter((part, i) => !partAllowed(part, sh.writes[i]!, p, input, ctx));
    return [...new Set((todo.length ? todo : sh.parts).map(bashRule))];
  }
  if (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool)) {
    const kind = READ_TOOLS.has(tool) ? "Read" : "Edit";
    const { path, dir } = toolPath(tool, input, ctx);
    if (kind === "Edit" && isProtected(path, p, ctx)) return [`Edit(${rulePath(path, ctx)})`];
    const folder = dir ? path : dirname(path);
    const broad = folder === realish(ctx.userHome) || folder.split("/").filter(Boolean).length < 2;
    if (broad) return [`${kind}(${dir ? `${rulePath(folder, ctx).replace(/\/$/, "")}/*` : rulePath(path, ctx)})`];
    return [`${kind}(${rulePath(folder, ctx)}/**)`];
  }
  if (tool === "WebFetch") {
    const host = hostOf(input.url);
    return [host ? `WebFetch(domain:${host})` : "WebFetch"];
  }
  return [tool];
}

function bashRule(part: string): string {
  const words = part.split(/\s+/);
  const first = words[0]!;
  if (EXACT_ONLY.has(first)) return `Bash(${part})`;
  if (TWO_WORDS.has(first) && words[1] && !words[1].startsWith("-")) return `Bash(${first} ${words[1]}:*)`;
  return `Bash(${first}:*)`;
}

function partAllowed(part: string, writes: boolean, p: ClaudePermissions, input: Record<string, unknown>, ctx: PermissionContext): boolean {
  if (p.categories.otherCommands) return true;
  if (p.categories.safeCommands && !writes && SAFE_COMMANDS.includes(part.split(/\s+/)[0]!)) return true;
  return p.rules.some((r) => ruleMatches(r.rule, "Bash", input, ctx, part, writes));
}

/** Whether Claude may do this without asking, given the settings. */
export function decide(p: ClaudePermissions, ctx: PermissionContext, tool: string, input: Record<string, unknown> = {}): Decision {
  if (PAID_TOOLS.has(tool)) return { allow: false, paid: true };
  const ask = (): Decision => ({ allow: false, alwaysRules: suggestRules(tool, input, ctx, p) });
  if (tool === "Bash") {
    const cmd = String(input.command ?? "").trim();
    const sh = parseCommand(cmd);
    if (p.rules.some((r) => ruleMatches(r.rule, tool, input, ctx))) return { allow: true, why: "règle" };
    if (p.categories.otherCommands) return { allow: true, why: "autres commandes" };
    if (sh.complex || !sh.parts.length) return ask();
    return sh.parts.every((part, i) => partAllowed(part, sh.writes[i]!, p, input, ctx)) ? { allow: true, why: "commandes sans risque" } : ask();
  }
  if (p.rules.some((r) => ruleMatches(r.rule, tool, input, ctx))) return { allow: true, why: "règle" };
  if (tool.startsWith("mcp__cezane__")) return { allow: true, why: "outil Cezane" };
  const anywhere = p.level === "autonome";
  if (READ_TOOLS.has(tool)) {
    const { path } = toolPath(tool, input, ctx);
    return p.categories.read && (anywhere || inScope(path, ctx)) ? { allow: true, why: "lecture" } : ask();
  }
  if (EDIT_TOOLS.has(tool)) {
    const { path } = toolPath(tool, input, ctx);
    return p.categories.edit && !isProtected(path, p, ctx) && (anywhere || inScope(path, ctx)) ? { allow: true, why: "modification" } : ask();
  }
  if (tool === "WebFetch" || tool === "WebSearch") return p.categories.web ? { allow: true, why: "web" } : ask();
  return anywhere ? { allow: true, why: "autonome" } : ask();
}

/** One line for the permission card. */
export function describeRequest(tool: string, input: Record<string, unknown>, ctx: PermissionContext): string {
  if (tool === "Bash") return "Claude veut lancer une commande.";
  if (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool)) {
    const where = rulePath(toolPath(tool, input, ctx).path, ctx).replace(/^\/\//, "/");
    return `Claude veut ${READ_TOOLS.has(tool) ? "lire" : "modifier"} ${where === "." ? "le dossier du projet" : where}.`;
  }
  if (tool === "WebFetch") return `Claude veut ouvrir ${hostOf(input.url) ?? "une page web"}.`;
  if (tool === "WebSearch") return "Claude veut chercher sur le web.";
  return `Claude veut utiliser ${tool}.`;
}

// ───────────────────────── Claude Code arguments ─────────────────────────

export type CliSettings = { permissions: { allow: string[]; ask: string[]; deny: string[]; additionalDirectories: string[] } };

/**
 * The settings as Claude Code permission rules, for `claude --settings <file>`. Équilibré:
 * Read/Edit in the project (`./**`) and ~/Cezane, `Bash(<safe>:*)`, WebFetch, WebSearch.
 * `ask` keeps Cezane's own documents (montages, cezane.json…) and the permission file behind a card.
 */
export function cliSettings(p: ClaudePermissions, ctx: PermissionContext): CliSettings {
  const c = p.categories;
  const anywhere = p.level === "autonome";
  const home = rulePath(realish(ctx.home), ctx);
  const allow: string[] = [];
  const ask: string[] = [];
  if (c.read) allow.push(...(anywhere ? ["Read", "Glob", "Grep"] : ["Read(./**)", `Read(${home}/**)`]));
  // Claude Code reads its working folder without asking: an ask rule makes "lecture" mean it.
  else ask.push("Read(./**)");
  if (c.edit) allow.push(...(anywhere ? ["Edit", "Write", "NotebookEdit"] : ["Edit(./**)", `Edit(${home}/**)`]));
  if (c.safeCommands) allow.push(...SAFE_COMMANDS.map((x) => `Bash(${x}:*)`));
  if (c.web) allow.push("WebFetch", "WebSearch");
  if (c.otherCommands) allow.push("Bash");
  for (const r of p.rules) if (!allow.includes(r.rule)) allow.push(r.rule);
  ask.push(...settingsFiles(ctx).map((f) => `Edit(${rulePath(f, ctx)})`));
  if (c.edit && !anywhere) ask.push("Edit(./cezane.json)", "Edit(./versions.json)", "Edit(./comments.json)", "Edit(./montages/**)", "Edit(./canvases/**)", "Edit(./.cezane/**)");
  return { permissions: { allow, ask, deny: [], additionalDirectories: c.read && !anywhere ? [realish(ctx.home)] : [] } };
}

// ───────────────────────── storage ─────────────────────────

type SettingsDoc = { version?: number; claude?: { permissions?: Partial<ClaudePermissions> }; [k: string]: unknown };

const fail = (msg: string) => Object.assign(new Error(msg), { status: 400 });

/** ~/Cezane/settings.json: global settings of every project. Only written when something changes. */
export class SettingsStore {
  readonly file: string;
  private cache?: { mtime: number; doc: SettingsDoc };

  constructor(readonly home: string = CEZANE_HOME) {
    this.file = join(home, "settings.json");
  }

  private doc(): SettingsDoc {
    const mtime = existsSync(this.file) ? statSync(this.file).mtimeMs : 0;
    if (this.cache?.mtime === mtime) return this.cache.doc;
    let doc: SettingsDoc = {};
    if (mtime) {
      try {
        doc = JSON.parse(readFileSync(this.file, "utf8")) as SettingsDoc;
      } catch (e) {
        console.error(`[settings] ${this.file}: ${e instanceof Error ? e.message : e}; defaults used`);
      }
    }
    this.cache = { mtime, doc };
    return doc;
  }

  /** The permissions, completed: a missing switch takes its level's preset. */
  permissions(): ClaudePermissions {
    const saved = this.doc().claude?.permissions ?? {};
    const level: PermissionLevel = PERMISSION_LEVELS.includes(saved.level as PermissionLevel) ? (saved.level as PermissionLevel) : DEFAULT_PERMISSIONS.level;
    const categories = { ...LEVEL_PRESETS[level] };
    for (const c of PERMISSION_CATEGORIES) if (typeof saved.categories?.[c] === "boolean") categories[c] = saved.categories[c]!;
    const rules = (Array.isArray(saved.rules) ? saved.rules : []).filter((r) => r && typeof r.rule === "string" && parseRule(r.rule));
    return { level, categories, rules };
  }

  view(): PermissionsView {
    const p = this.permissions();
    return { ...p, file: this.file, home: this.home, safeCommands: SAFE_COMMANDS, custom: isCustomPermissions(p) };
  }

  context(projectDir: string): PermissionContext {
    return { projectDir, home: this.home, userHome: homedir() };
  }

  private save(p: ClaudePermissions): PermissionsView {
    const doc = this.doc();
    const next: SettingsDoc = { ...doc, version: 1, claude: { ...(doc.claude ?? {}), permissions: p } };
    mkdirSync(this.home, { recursive: true });
    writeAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`);
    this.cache = undefined;
    return this.view();
  }

  update(patch: PermissionsPatch): PermissionsView {
    const p = this.permissions();
    if (patch.level !== undefined) {
      if (!PERMISSION_LEVELS.includes(patch.level)) throw fail(`level must be one of ${PERMISSION_LEVELS.join(", ")}`);
      if (patch.level !== p.level) p.categories = { ...LEVEL_PRESETS[patch.level] };
      p.level = patch.level;
    }
    for (const [k, v] of Object.entries(patch.categories ?? {})) {
      if (!PERMISSION_CATEGORIES.includes(k as PermissionCategory) || typeof v !== "boolean") throw fail(`unknown category ${k}`);
      p.categories[k as PermissionCategory] = v;
    }
    return this.save(p);
  }

  addRules(rules: string[], example?: string): PermissionsView {
    const p = this.permissions();
    for (const raw of rules) {
      const rule = String(raw ?? "").trim();
      if (!rule || rule.length > 500 || !parseRule(rule)) throw fail(`invalid rule: ${rule || "(empty)"}`);
      if (!p.rules.some((r) => r.rule === rule)) p.rules.push({ rule, addedAt: new Date().toISOString(), ...(example ? { example: example.slice(0, 160) } : {}) });
    }
    return this.save(p);
  }

  removeRule(rule: string): PermissionsView {
    const p = this.permissions();
    const n = p.rules.length;
    p.rules = p.rules.filter((r) => r.rule !== rule);
    if (p.rules.length === n) throw Object.assign(new Error(`unknown rule: ${rule}`), { status: 404 });
    return this.save(p);
  }
}

/** The request in a few words, kept with the rule it made ("ffprobe -v error clip.mov", "~/Downloads/a.mov"). */
export function requestExample(tool: string, input: Record<string, unknown>, ctx: PermissionContext): string | undefined {
  if (tool === "Bash") return String(input.command ?? "").slice(0, 160) || undefined;
  if (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool)) return rulePath(toolPath(tool, input, ctx).path, ctx).replace(/^\/\//, "/");
  if (tool === "WebFetch") return String(input.url ?? "").slice(0, 160) || undefined;
  if (tool === "WebSearch") return String(input.query ?? "").slice(0, 160) || undefined;
  return undefined;
}
