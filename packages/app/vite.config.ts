import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const SERVER = "http://127.0.0.1:4317";
const brandDir = resolve(__dirname, "../../assets/brand");
const mime: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".m4a": "audio/mp4", ".json": "application/json",
};

/** Dev/preview only: serves /brand from assets/brand and /mock-media from $CEZANE_MOCK_MEDIA. */
function localFiles(): Plugin {
  const serve = (prefix: string, dir: string | undefined) => (req: any, res: any, next: () => void) => {
    if (!dir || !req.url?.startsWith(prefix)) return next();
    const rel = decodeURIComponent(req.url.slice(prefix.length).split("?")[0]);
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) return next();
    const size = statSync(file).size;
    const type = mime[extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const start = Number(range[1] || 0);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
      createReadStream(file).pipe(res);
    }
  };
  const mock = process.env.CEZANE_MOCK_MEDIA ? resolve(process.env.CEZANE_MOCK_MEDIA) : undefined;
  const install = (mw: { use: (fn: any) => void }) => {
    mw.use(serve("/brand/", brandDir));
    mw.use(serve("/mock-media/", mock));
  };
  return {
    name: "cezane-local-files",
    configureServer: (s) => install(s.middlewares),
    configurePreviewServer: (s) => install(s.middlewares),
  };
}

const proxy = {
  "/api": { target: SERVER },
  "/files": { target: SERVER },
  "/brand": { target: SERVER },
};

export default defineConfig({
  plugins: [react(), localFiles()],
  server: { port: 5317, proxy },
  preview: { port: 5318, proxy },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
