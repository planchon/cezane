// bun packages/app/scripts/install-mac.ts [destDir]
// Installs Cezane.app (default: /Applications) running this checkout: builds the UI and the
// Electron main, wraps them in a renamed copy of Electron.app with the Cezane icon, and re-signs it
// ad hoc. Re-run it to update the app or to point it at another checkout.
// (The self-contained app for other Macs is scripts/release-mac.ts.)
import { $ } from "bun";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appDir, buildElectronMain, buildShell, repo, signAdHoc, version } from "./mac-app";

const dest = join(resolve(process.argv[2] ?? "/Applications"), "Cezane.app");

await $`bun run build`.cwd(appDir).quiet();
await buildElectronMain();
const code = await buildShell(dest, { CFBundleShortVersionString: version, CFBundleVersion: version });
writeFileSync(join(code, "repo.json"), JSON.stringify({ repo }, null, 2));

await signAdHoc(dest);
await $`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f ${dest}`.quiet().nothrow();
console.log(`Installed ${dest} → ${repo}`);
