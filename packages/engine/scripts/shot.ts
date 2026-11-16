// Screenshot of a page in headless Chrome: bun packages/engine/scripts/shot.ts <url> <out.png> [width] [height] [waitMs]
import { captureWeb } from "../src/capture";

const [url, out, w, h, wait] = process.argv.slice(2);
if (!url || !out) throw new Error("usage: shot.ts <url> <out.png> [width] [height] [waitMs]");
await captureWeb({ url, out, width: Number(w ?? 1440), height: Number(h ?? 900), scale: 1, waitMs: Number(wait ?? 1500) });
console.log(out);
