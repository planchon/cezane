// bun packages/app/scripts/install-mac.ts [destDir]
// Installs Cezane.app (default: /Applications) running this checkout: builds the UI and the
// Electron main, wraps them in a renamed copy of Electron.app with the Cezane icon, and re-signs it
// ad hoc. Re-run it to update the app or to point it at another checkout.
import { $ } from "bun";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const appDir = resolve(import.meta.dir, "..");
const repo = resolve(appDir, "../..");
const dest = join(resolve(process.argv[2] ?? "/Applications"), "Cezane.app");
const electron = join(dirname(Bun.resolveSync("electron/package.json", appDir)), "dist/Electron.app");
if (!existsSync(electron)) throw new Error(`Electron.app not found at ${electron}; run bun install`);

await $`bun run build`.cwd(appDir).quiet();
await $`bun build ./electron/main.ts --target=node --format=cjs -e electron --outfile dist-electron/main.cjs`.cwd(appDir).quiet();

rmSync(dest, { recursive: true, force: true });
await $`ditto ${electron} ${dest}`;

const res = join(dest, "Contents/Resources");
rmSync(join(res, "default_app.asar"), { force: true });
const code = join(res, "app");
mkdirSync(code, { recursive: true });
await $`cp ${join(appDir, "dist-electron/main.cjs")} ${join(code, "main.cjs")}`;
writeFileSync(join(code, "package.json"), JSON.stringify({ name: "cezane", productName: "Cezane", version: "0.1.0", main: "main.cjs" }, null, 2));
writeFileSync(join(code, "repo.json"), JSON.stringify({ repo }, null, 2));

const icns = join(repo, "assets/brand/Cezane.icns");
if (existsSync(icns)) await $`cp ${icns} ${join(res, "electron.icns")}`;
const plist = join(dest, "Contents/Info.plist");
for (const [key, value] of [["CFBundleName", "Cezane"], ["CFBundleDisplayName", "Cezane"], ["CFBundleIdentifier", "app.cezane.desktop"]]) {
  await $`plutil -replace ${key} -string ${value} ${plist}`;
}

await $`codesign --force --deep --sign - ${dest}`.quiet();
await $`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f ${dest}`.quiet().nothrow();
console.log(`Installed ${dest} → ${repo}`);
