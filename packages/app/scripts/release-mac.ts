// bun run release:mac [--keep]
// Self-contained Cezane.app for Apple Silicon Macs, for a GitHub Release:
//   out/release/Cezane-<version>-arm64.zip   (ditto, keeps the signature)
//   out/release/Cezane-<version>-arm64.dmg   (drag to Applications)
// The app carries its runtime in Contents/Resources/app/runtime, laid out like the checkout so
// REPO_DIR (engine proc.ts) still works: bun (the one running this script), the server, engine,
// core and remotion sources, the built UI, the assets, the prebuilt Apple Vision helper, and
// production node_modules installed from bun.lock. The runtime is read-only: caches, the render
// bundle and Remotion's headless Chrome go to ~/Cezane/cache (see cezane-runtime.json, PACKAGED).
// Signed ad hoc (no Developer ID, not notarized). --keep leaves out/release/stage/ for inspection.
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appDir, buildElectronMain, buildShell, repo, signAdHoc, version } from "./mac-app";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("release:mac builds the Apple Silicon app: run it on an arm64 Mac");
const keep = process.argv.includes("--keep");
const outDir = join(repo, "out/release");
const stage = join(outDir, "stage");
const name = `Cezane-${version}-arm64`;
const app = join(stage, "Cezane.app");
const step = (s: string) => console.log(`· ${s}`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

step("Electron shell");
await buildElectronMain();
const code = await buildShell(app, { CFBundleShortVersionString: version, CFBundleVersion: version, LSMinimumSystemVersion: "14.0" });
const rt = join(code, "runtime");
mkdirSync(rt, { recursive: true });

step("sources");
const copy = (from: string, to = from, filter?: (src: string) => boolean) => cpSync(join(repo, from), join(rt, to), { recursive: true, filter });
copy("package.json");
copy("bun.lock");
const noTests = (src: string) => !/\.test\.tsx?$/.test(src);
for (const pkg of ["core", "engine", "server", "remotion"]) {
  copy(`packages/${pkg}/package.json`);
  copy(`packages/${pkg}/src`, undefined, noTests);
}
copy("packages/remotion/public");
// The app workspace's manifest keeps the workspace list identical to bun.lock (frozen install).
copy("packages/app/package.json");

step("UI");
await $`bun run build --outDir ${join(rt, "packages/app/dist")} --emptyOutDir`.cwd(appDir).quiet();

step("assets");
copy("assets/luts");
copy("assets/rnnoise/bd.rnnn");
// Only what the server and the window use (/brand/… in the UI, the dock icon).
for (const f of ["loading.gif", "mood-montage.png", "logo-mark.png", "app-icon.png", "app-icon-square.png"]) {
  if (existsSync(join(repo, "assets/brand", f))) copy(`assets/brand/${f}`);
}

step("Apple Vision helper");
await $`swift build -c release --package-path ${join(repo, "native/vision")}`.quiet();
mkdirSync(join(rt, "bin"), { recursive: true });
const vision = join(rt, "bin/cezane-vision");
cpSync(join(repo, "native/vision/.build/release/cezane-vision"), vision);
// No debug symbols (they carry this checkout's paths); re-signed, as Resources/ is not signed with the app.
await $`strip -S -x ${vision}`.quiet();
await $`codesign --force --sign - ${vision}`.quiet();

step(`bun ${Bun.version}`);
// The binary running this script, with Oven's signature (left as is: it sits in Resources).
await $`cp -p ${process.execPath} ${join(rt, "bun")}`;
const arch = (await $`lipo -archs ${join(rt, "bun")}`.text()).trim();
if (arch !== "arm64") throw new Error(`bun is ${arch}, expected arm64`);

step("node_modules (production, frozen bun.lock)");
await $`${join(rt, "bun")} install --production --frozen-lockfile --filter @cezane/server`.cwd(rt).quiet();
// @remotion/bundler only loads rspack when asked to (bundle({ rspack: true }), never done here):
// its 40 MB native binding goes, with the links to it.
const store = join(rt, "node_modules/.bun");
for (const d of readdirSync(store).filter((d) => d.startsWith("@rspack+binding-darwin-"))) rmSync(join(store, d), { recursive: true, force: true });
await $`find ${rt}/node_modules -type l -name 'binding-darwin-*' -path '*/@rspack/*' -delete`;
const dangling = (await $`find -L ${rt}/node_modules -type l`.text()).trim();
if (dangling) throw new Error(`dangling links in node_modules:\n${dangling}`);
for (const forbidden of ["electron", "vite", "tldraw", "typescript"]) {
  if (readdirSync(join(rt, "node_modules/.bun")).some((d) => d.startsWith(`${forbidden}@`))) throw new Error(`${forbidden} ended up in the runtime`);
}

writeFileSync(join(rt, "cezane-runtime.json"), `${JSON.stringify({ name: "cezane", version, arch: "arm64", bun: Bun.version }, null, 2)}\n`);

// Nothing of this Mac may leak into the app (paths of the checkout, of the home folder).
const leaks = (await $`grep -rl --binary-files=binary -e ${repo} -e ${process.env.HOME ?? "/Users/"} ${app}`.nothrow().text()).trim();
if (leaks) throw new Error(`local paths inside the app:\n${leaks}`);

step("signature");
await signAdHoc(app);
await $`codesign --verify --deep --strict ${app}`.quiet();
const bunSig = await $`codesign -dv ${join(rt, "bun")} 2>&1`.nothrow().text();
if (!/TeamIdentifier=7FRXF46ZSN/.test(bunSig)) throw new Error(`bun lost its signature:\n${bunSig}`);

step("zip and dmg");
const zip = join(outDir, `${name}.zip`);
const dmg = join(outDir, `${name}.dmg`);
rmSync(zip, { force: true });
rmSync(dmg, { force: true });
await $`ditto -c -k --keepParent ${app} ${zip}`;
const dmgRoot = join(stage, "dmg");
mkdirSync(dmgRoot);
await $`ditto ${app} ${join(dmgRoot, "Cezane.app")}`;
symlinkSync("/Applications", join(dmgRoot, "Applications"));
// lzma: the smallest image (ULFO and UDZO come out 15–25 % bigger), mounts on any Apple Silicon Mac.
await $`hdiutil create -volname Cezane -srcfolder ${dmgRoot} -ov -format ULMO ${dmg}`.quiet();

const size = async (p: string) => `${Math.round(Number((await $`du -sk ${p}`.text()).split("\t")[0]) / 1024)} MB`;
console.log(`\nCezane ${version} (arm64, bun ${Bun.version})`);
console.log(`  app  ${await size(app)}`);
console.log(`  zip  ${Math.round(statSync(zip).size / 1e6)} MB  ${zip}`);
console.log(`  dmg  ${Math.round(statSync(dmg).size / 1e6)} MB  ${dmg}`);
if (keep) console.log(`  stage kept: ${stage}`);
else rmSync(stage, { recursive: true, force: true });
