// Electron shell: makes sure `cezane serve` runs, then shows its UI in one window.
import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";

const PORT = Number(process.env.CEZANE_PORT ?? 4317);
const BASE = `http://127.0.0.1:${PORT}`;

// The installed Cezane.app carries repo.json (written by scripts/install-mac.ts) pointing at the checkout it runs from.
function repoRoot(): string {
  if (process.env.CEZANE_REPO) return resolve(process.env.CEZANE_REPO);
  const baked = join(__dirname, "repo.json");
  if (existsSync(baked)) return (JSON.parse(readFileSync(baked, "utf8")) as { repo: string }).repo;
  return resolve(__dirname, "../../..");
}
const repo = repoRoot();
let server: ReturnType<typeof spawn> | undefined;

async function alive(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function bunPath(): string {
  const candidates = [process.env.BUN_PATH, join(homedir(), ".bun/bin/bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun"];
  return candidates.find((p) => p && existsSync(p)) ?? "bun";
}

function projectDir(): string {
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith("-") && a !== ".");
  return resolve(args[0] ?? process.env.CEZANE_PROJECT ?? join(repo, "demo/cezane-demo"));
}

async function ensureServer() {
  if (await alive()) return;
  const dir = projectDir();
  const proc = spawn(bunPath(), [join(repo, "packages/server/src/cli.ts"), "serve", dir, "--port", String(PORT)], {
    cwd: repo,
    stdio: ["ignore", "inherit", "inherit"],
    // Apps opened from Finder get a minimal PATH: add where bun, claude, ffmpeg and whisper-cli usually live.
    env: { ...process.env, PATH: `${join(homedir(), ".bun/bin")}:${join(homedir(), ".local/bin")}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` },
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
  throw new Error(`cezane serve did not answer on ${BASE}`);
}

function icon() {
  const file = ["app-icon.png", "app-icon-square.png"].map((f) => join(repo, "assets/brand", f)).find(existsSync);
  return file ? nativeImage.createFromPath(file) : undefined;
}

// "Ouvrir un dossier…" in the app: the macOS folder picker, for the Cezane page only (see preload.ts).
ipcMain.handle("cezane:pick-folder", async (e) => {
  const from = e.senderFrame?.url ?? "";
  if (!from.startsWith(BASE) && !(process.env.VITE_DEV_URL && from.startsWith(process.env.VITE_DEV_URL))) return null;
  const projets = join(process.env.CEZANE_HOME ?? join(homedir(), "Cezane"), "Projets");
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
    webPreferences: { contextIsolation: true, sandbox: true, preload: join(__dirname, "preload.cjs") },
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
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) void createWindow();
});
app.on("before-quit", () => {
  server?.kill("SIGTERM");
});
