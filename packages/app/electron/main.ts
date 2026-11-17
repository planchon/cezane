// Electron shell: makes sure `cezane serve` runs, then shows its UI in one window.
import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";

// Where main.cjs runs from. Not __dirname: `bun build` inlines it as the source folder at build time.
const HERE = dirname(require.main?.filename ?? join(process.resourcesPath, "app/main.cjs"));

const PORT = Number(process.env.CEZANE_PORT ?? 4317);
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = process.env.CEZANE_HOME ?? join(homedir(), "Cezane");

// The released Cezane.app (scripts/release-mac.ts) carries its own runtime next to this file: bun,
// the server sources and their node_modules. The dev install (scripts/install-mac.ts) carries
// repo.json instead, pointing at the checkout it runs from.
const RUNTIME = join(HERE, "runtime");
const packaged = existsSync(join(RUNTIME, "cezane-runtime.json"));

function repoRoot(): string {
  if (process.env.CEZANE_REPO) return resolve(process.env.CEZANE_REPO);
  if (packaged) return RUNTIME;
  const baked = join(HERE, "repo.json");
  if (existsSync(baked)) return (JSON.parse(readFileSync(baked, "utf8")) as { repo: string }).repo;
  return resolve(HERE, "../../..");
}
const repo = repoRoot();
let server: ReturnType<typeof spawn> | undefined;

async function alive(): Promise<boolean> {
  try {
    // A global route: /api/state would open (or create) a default project.
    const r = await fetch(`${BASE}/api/jobs`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function bunPath(): string {
  if (packaged) return join(RUNTIME, "bun");
  const candidates = [process.env.BUN_PATH, join(homedir(), ".bun/bin/bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun"];
  return candidates.find((p) => p && existsSync(p)) ?? "bun";
}

/** The project to open first: given on the command line or in CEZANE_PROJECT; the dev app defaults to the demo. */
function projectDir(): string | undefined {
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith("-") && a !== ".");
  const given = args[0] ?? process.env.CEZANE_PROJECT;
  if (given) return resolve(given);
  // Released app: no demo, the Atelier opens (on the last projects, or empty the first time).
  return packaged ? undefined : resolve(repo, "demo/cezane-demo");
}

async function ensureServer() {
  if (await alive()) return;
  const dir = projectDir();
  // Released app: the bundle is read-only, so the server runs from ~/Cezane and logs to ~/Cezane/logs.
  let stdio: ("ignore" | "inherit" | number)[] = ["ignore", "inherit", "inherit"];
  if (packaged) {
    mkdirSync(join(HOME, "logs"), { recursive: true });
    const log = openSync(join(HOME, "logs/server.log"), "a");
    stdio = ["ignore", log, log];
  }
  const args = [...(packaged ? ["--no-install"] : []), join(repo, "packages/server/src/cli.ts"), "serve", ...(dir ? [dir] : []), "--port", String(PORT)];
  const proc = spawn(bunPath(), args, {
    cwd: packaged ? HOME : repo,
    stdio,
    // Apps opened from Finder get a minimal PATH: add where bun, claude, ffmpeg and whisper-cli usually live.
    env: {
      ...process.env,
      PATH: [join(homedir(), ".bun/bin"), join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin"].join(":"),
    },
  });
  server = proc;
  (proc as unknown as EventEmitter).on("exit", (code: number | null) => {
    if (code) console.error(`cezane serve exited with ${code}`);
    server = undefined;
  });
  for (let i = 0; i < 120; i++) {
    if (await alive()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`cezane serve did not answer on ${BASE}${packaged ? ` (journal : ${join(HOME, "logs/server.log")})` : ""}`);
}

function icon() {
  const file = ["app-icon.png", "app-icon-square.png"].map((f) => join(repo, "assets/brand", f)).find(existsSync);
  return file ? nativeImage.createFromPath(file) : undefined;
}

// "Ouvrir un dossier…" in the app: the macOS folder picker, for the Cezane page only (see preload.ts).
ipcMain.handle("cezane:pick-folder", async (e) => {
  const from = e.senderFrame?.url ?? "";
  if (!from.startsWith(BASE) && !(process.env.VITE_DEV_URL && from.startsWith(process.env.VITE_DEV_URL))) return null;
  const projets = join(HOME, "Projets");
  const opts: Electron.OpenDialogOptions = {
    title: "Ouvrir un dossier",
    buttonLabel: "Ouvrir",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: existsSync(projets) ? projets : homedir(),
  };
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

async function createWindow() {
  const img = icon();
  if (img && process.platform === "darwin") app.dock?.setIcon(img);
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: "Cezane",
    titleBarStyle: "hiddenInset",
    // Centred in the app's 40 px top strip (the future project tabs), which is the drag region.
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: "#EFEFEE",
    icon: img,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, preload: join(HERE, "preload.cjs") },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  try {
    await ensureServer();
    await win.loadURL(process.env.VITE_DEV_URL ?? `${BASE}/`);
  } catch (e) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="font-family:-apple-system;font-size:13px;background:#EFEFEE;color:rgba(0,0,0,.9);padding:60px"><h2>Cezane</h2><p>${String(e)}</p></body>`)}`);
    win.show();
  }
}

app.setName("Cezane");
// Its own Electron profile when asked (a release copy tested next to the dev app, which uses the default one).
if (process.env.CEZANE_USER_DATA) app.setPath("userData", resolve(process.env.CEZANE_USER_DATA));
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) void createWindow();
});
app.on("before-quit", () => {
  server?.kill("SIGTERM");
});
