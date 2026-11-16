import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { runOk } from "./proc";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export type WebAction =
  | { wait: number }
  | { click: string }
  | { type: [string, string] }
  | { scroll: number; ms?: number } // smooth scroll by N px
  | { goto: string }
  | { hover: string };

export type WebCaptureOptions = {
  url: string;
  out: string; // .png for a screenshot, .webm/.mp4 for a recording
  width?: number;
  height?: number;
  scale?: number; // device scale factor
  fullPage?: boolean;
  dark?: boolean;
  actions?: WebAction[];
  waitMs?: number;
};

async function smoothScroll(page: Page, px: number, ms: number) {
  await page.evaluate(
    async (px, ms) => {
      const start = window.scrollY;
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const step = (t: number) => {
          const k = Math.min(1, (t - t0) / ms);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          window.scrollTo(0, start + px * e);
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    },
    px,
    ms,
  );
}

async function runActions(page: Page, actions: WebAction[]) {
  for (const a of actions) {
    if ("wait" in a) await new Promise((r) => setTimeout(r, a.wait));
    else if ("click" in a) await page.click(a.click);
    else if ("hover" in a) await page.hover(a.hover);
    else if ("type" in a) await page.type(a.type[0], a.type[1], { delay: 40 });
    else if ("scroll" in a) await smoothScroll(page, a.scroll, a.ms ?? 1200);
    else if ("goto" in a) await page.goto(a.goto, { waitUntil: "networkidle2" });
  }
}

/** Screenshot or screen recording of a web page in Chrome (SaaS demos). */
export async function captureWeb(o: WebCaptureOptions): Promise<string> {
  mkdirSync(dirname(o.out), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: o.width ?? 1440, height: o.height ?? 900, deviceScaleFactor: o.scale ?? 2 },
    args: ["--hide-scrollbars"],
  });
  try {
    const page = await browser.newPage();
    if (o.dark) await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await page.goto(o.url, { waitUntil: "networkidle2", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, o.waitMs ?? 800));
    if (/\.(webm|mp4)$/.test(o.out)) {
      const rec = await page.screencast({ path: o.out as `${string}.webm` });
      await runActions(page, o.actions?.length ? o.actions : [{ wait: 800 }, { scroll: 900, ms: 2500 }, { wait: 800 }]);
      await rec.stop();
    } else {
      if (o.actions) await runActions(page, o.actions);
      await page.screenshot({ path: o.out as `${string}.png`, fullPage: o.fullPage ?? false });
    }
    return o.out;
  } finally {
    await browser.close();
  }
}

/** Screenshot or recording of the booted iOS simulator. */
export async function captureIos(o: { out: string; device?: string; seconds?: number }): Promise<string> {
  mkdirSync(dirname(o.out), { recursive: true });
  const device = o.device ?? "booted";
  if (o.out.endsWith(".png")) {
    await runOk(["xcrun", "simctl", "io", device, "screenshot", o.out]);
    return o.out;
  }
  const proc = Bun.spawn(["xcrun", "simctl", "io", device, "recordVideo", "--codec=h264", "--force", o.out], { stdout: "ignore", stderr: "pipe" });
  await new Promise((r) => setTimeout(r, (o.seconds ?? 8) * 1000));
  proc.kill("SIGINT");
  await proc.exited;
  return o.out;
}
