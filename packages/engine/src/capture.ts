import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { runOk } from "./proc";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export type WebAction =
  | { wait: number }
  | { click: string; label?: string } // CSS selector, or text with ::-p-text(...)
  | { type: [string, string] }
  | { scroll: number; ms?: number } // smooth scroll of the window by N px
  | { wheel: number; ms?: number } // mouse-wheel scroll by N px (works in inner containers too)
  | { press: string } // keyboard key, e.g. "Enter", "Meta+K"
  | { write: string } // type text into whatever has focus
  | { goto: string }
  | { hover: string };

/** What happened during a recording, for the cursor overlay. t in seconds, x/y 0..1 of the viewport. */
export type WebEvent = { t: number; type: "click" | "hover" | "type" | "scroll" | "press" | "goto"; x?: number; y?: number; label?: string; dy?: number };

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Center of an element, 0..1 of the viewport. */
async function centerOf(page: Page, selector: string) {
  const el = await page.waitForSelector(selector, { timeout: 8000 });
  const box = await el!.boundingBox();
  const vp = page.viewport()!;
  return box ? { x: (box.x + box.width / 2) / vp.width, y: (box.y + box.height / 2) / vp.height, px: box.x + box.width / 2, py: box.y + box.height / 2 } : undefined;
}

async function runActions(page: Page, actions: WebAction[], log?: (e: Omit<WebEvent, "t">) => void) {
  for (const a of actions) {
    if ("wait" in a) await sleep(a.wait);
    else if ("click" in a) {
      const c = await centerOf(page, a.click);
      if (c) await page.mouse.move(c.px, c.py, { steps: 8 });
      log?.({ type: "click", x: c?.x, y: c?.y, label: a.label });
      await page.click(a.click);
    } else if ("hover" in a) {
      const c = await centerOf(page, a.hover);
      log?.({ type: "hover", x: c?.x, y: c?.y });
      await page.hover(a.hover);
    } else if ("type" in a) {
      const c = await centerOf(page, a.type[0]);
      log?.({ type: "type", x: c?.x, y: c?.y });
      await page.type(a.type[0], a.type[1], { delay: 70 });
    } else if ("write" in a) {
      log?.({ type: "type", label: a.write });
      await page.keyboard.type(a.write, { delay: 85 });
    } else if ("press" in a) {
      log?.({ type: "press", label: a.press });
      const keys = a.press.split("+") as Parameters<Page["keyboard"]["down"]>[0][];
      for (const k of keys) await page.keyboard.down(k);
      for (const k of keys.reverse()) await page.keyboard.up(k);
    } else if ("scroll" in a) {
      log?.({ type: "scroll", dy: a.scroll });
      await smoothScroll(page, a.scroll, a.ms ?? 1200);
    } else if ("wheel" in a) {
      log?.({ type: "scroll", dy: a.wheel });
      const vp = page.viewport()!;
      await page.mouse.move(vp.width / 2, vp.height * 0.6);
      const steps = Math.max(1, Math.round((a.ms ?? 1500) / 16));
      for (let i = 0; i < steps; i++) {
        // ease in-out over the steps
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const e = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
        await page.mouse.wheel({ deltaY: a.wheel * (e(t1) - e(t0)) });
        await sleep(16);
      }
    } else if ("goto" in a) {
      log?.({ type: "goto", label: a.goto });
      await page.goto(a.goto, { waitUntil: "networkidle2" });
    }
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
      // The recording comes with an event log (clicks, typing, scrolls) for the cursor overlay.
      const rec = await page.screencast({ path: o.out as `${string}.webm`, quality: 20, fps: 30 });
      const t0 = performance.now();
      const events: WebEvent[] = [];
      const log = (e: Omit<WebEvent, "t">) => events.push({ t: +((performance.now() - t0) / 1000).toFixed(3), ...e });
      try {
        await runActions(page, o.actions?.length ? o.actions : [{ wait: 800 }, { wheel: 900, ms: 2500 }, { wait: 800 }], log);
      } finally {
        await rec.stop(); // always, or ffmpeg keeps waiting and the browser never closes
      }
      writeFileSync(eventsPath(o.out), JSON.stringify({ width: o.width ?? 1440, height: o.height ?? 900, events }, null, 1));
    } else {
      if (o.actions) await runActions(page, o.actions);
      await page.screenshot({ path: o.out as `${string}.png`, fullPage: o.fullPage ?? false });
    }
    return o.out;
  } finally {
    await browser.close();
  }
}

/** Sidecar of a recording: `capture.webm` → `capture.events.json`. */
export const eventsPath = (video: string) => video.replace(/\.[^.]+$/, ".events.json");

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
