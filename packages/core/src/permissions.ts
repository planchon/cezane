// What Claude may do in Cezane without asking. Global for every project, stored in
// ~/Cezane/settings.json (CEZANE_HOME). Paid generations always ask, whatever the level.

/** Prudent: only the Cezane tools. Équilibré: the project and ~/Cezane, safe commands, the web. Autonome: everything. */
export type PermissionLevel = "prudent" | "equilibre" | "autonome";

/** Per-category switches on top of the level (a level sets them; the user can flip each one). */
export type PermissionCategory = "read" | "edit" | "safeCommands" | "web" | "otherCommands";

/** A rule added with "Toujours autoriser", in Claude Code's syntax: `WebSearch`, `Bash(git status:*)`, `Read(~/Downloads/**)`. */
export type PermissionRule = { rule: string; addedAt: string; example?: string };

export type ClaudePermissions = {
  level: PermissionLevel;
  categories: Record<PermissionCategory, boolean>;
  rules: PermissionRule[];
};

/** GET /api/settings/permissions */
export type PermissionsView = ClaudePermissions & {
  file: string; // ~/Cezane/settings.json
  home: string; // ~/Cezane
  safeCommands: string[]; // the "commandes sans risque"
  custom: boolean; // the switches differ from the level's preset
};

/** PUT /api/settings/permissions. A new level resets the switches to its preset unless `categories` is given too. */
export type PermissionsPatch = { level?: PermissionLevel; categories?: Partial<Record<PermissionCategory, boolean>> };

export const PERMISSION_LEVELS: PermissionLevel[] = ["prudent", "equilibre", "autonome"];
export const PERMISSION_CATEGORIES: PermissionCategory[] = ["read", "edit", "safeCommands", "web", "otherCommands"];

/** The switches each level sets. */
export const LEVEL_PRESETS: Record<PermissionLevel, Record<PermissionCategory, boolean>> = {
  prudent: { read: false, edit: false, safeCommands: false, web: false, otherCommands: false },
  equilibre: { read: true, edit: true, safeCommands: true, web: true, otherCommands: false },
  autonome: { read: true, edit: true, safeCommands: true, web: true, otherCommands: true },
};

/** Commands that only inspect media and files: allowed as `Bash(<cmd>:*)` when "commandes sans risque" is on. */
export const SAFE_COMMANDS = ["ffprobe", "ffmpeg", "ls", "file", "mdls", "sips", "cat", "head", "tail", "wc"];

export const DEFAULT_PERMISSIONS: ClaudePermissions = { level: "equilibre", categories: { ...LEVEL_PRESETS.equilibre }, rules: [] };

export const isCustomPermissions = (p: Pick<ClaudePermissions, "level" | "categories">) =>
  PERMISSION_CATEGORIES.some((c) => p.categories[c] !== LEVEL_PRESETS[p.level][c]);
