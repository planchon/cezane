// Records a web flow with its event log: bun packages/engine/scripts/record-web.ts '<json WebCaptureOptions>'
// e.g. {"url":"https://docs.rewind.codes","out":"/tmp/a.webm","dark":true,"actions":[{"wait":800},{"click":"a::-p-text(How it works)"}]}
import { captureWeb, eventsPath } from "../src/capture";

const o = JSON.parse(process.argv[2] ?? "{}");
if (!o.url || !o.out) throw new Error("usage: record-web.ts '{\"url\":…,\"out\":…,\"actions\":[…]}'");
await captureWeb(o);
console.log(o.out, eventsPath(o.out));
