// Prints the browser console errors of a page after an optional click:
// bun packages/engine/scripts/console.ts <url> [clickSelector]
import puppeteer from "puppeteer-core";

const [url, click] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.log(`console: ${m.text().slice(0, 600)}`));
page.on("pageerror", (e) => console.log(`pageerror: ${String(e).slice(0, 600)}`));
await page.goto(url!, { waitUntil: "networkidle2" });
if (click) await page.click(click);
await new Promise((r) => setTimeout(r, 2500));
await browser.close();
