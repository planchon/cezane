// Screenshot of a page in headless Chrome:
// bun packages/engine/scripts/shot.ts <url> <out.png> [width] [height] [waitMs] [clickSelector]
import { captureWeb } from "../src/capture";

const [url, out, w, h, wait, click] = process.argv.slice(2);
if (!url || !out) throw new Error("usage: shot.ts <url> <out.png> [width] [height] [waitMs] [clickSelector]");
const waitMs = Number(wait ?? 1500);
await captureWeb({ url, out, width: Number(w ?? 1440), height: Number(h ?? 900), scale: 1, waitMs, actions: click ? [{ click }, { wait: waitMs }] : [] });
console.log(out);
