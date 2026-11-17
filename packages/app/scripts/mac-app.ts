// Shared by install-mac.ts (dev app running a checkout) and release-mac.ts (self-contained app):
// Cezane.app is a renamed copy of Electron.app with our main/preload in Contents/Resources/app.
import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const appDir = resolve(import.meta.dir, "..");
export const repo = resolve(appDir, "../..");
export const version: string = (JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { version: string }).version;

const electronApp = () => {
  const p = join(dirname(Bun.resolveSync("electron/package.json", appDir)), "dist/Electron.app");
  if (!existsSync(p)) throw new Error(`Electron.app not found at ${p}; run bun install`);
  return p;
};

/** Builds the Electron main and preload (dist-electron/). */
export async function buildElectronMain() {
  await $`bun run build:electron`.cwd(appDir).quiet();
}

/**
 * Writes Cezane.app at `dest` (replaced): Electron.app renamed, our main/preload, icon and
 * Info.plist keys. Returns Contents/Resources/app, where the caller adds repo.json or the runtime.
 */
export async function buildShell(dest: string, plist: Record<string, string> = {}): Promise<string> {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  await $`ditto ${electronApp()} ${dest}`;
  const res = join(dest, "Contents/Resources");
  rmSync(join(res, "default_app.asar"), { force: true });
  const code = join(res, "app");
  mkdirSync(code, { recursive: true });
  await $`cp ${join(appDir, "dist-electron/main.cjs")} ${join(code, "main.cjs")}`;
  await $`cp ${join(appDir, "dist-electron/preload.cjs")} ${join(code, "preload.cjs")}`;
  writeFileSync(join(code, "package.json"), JSON.stringify({ name: "cezane", productName: "Cezane", version, main: "main.cjs" }, null, 2));
  const icns = join(repo, "assets/brand/Cezane.icns");
  if (existsSync(icns)) await $`cp ${icns} ${join(res, "electron.icns")}`;
  const info = join(dest, "Contents/Info.plist");
  const keys = { CFBundleName: "Cezane", CFBundleDisplayName: "Cezane", CFBundleIdentifier: "app.cezane.desktop", ...plist };
  for (const [key, value] of Object.entries(keys)) await $`plutil -replace ${key} -string ${value} ${info}`;
  return code;
}

/** Ad-hoc signature of the whole bundle (no Developer ID). */
export async function signAdHoc(app: string) {
  // Extended attributes (quarantine, provenance, Finder info) make codesign refuse the bundle.
  await $`xattr -cr ${app}`.quiet();
  await $`codesign --force --deep --sign - ${app}`.quiet();
}
