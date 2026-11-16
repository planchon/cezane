// Rewind explainer: SaaS screenshots in a browser frame, subtitles only, trending music.
// Run with `cezane serve demo/rewind` up: bun demo/scripts/rewind.ts
import { clearOps, edit, f, subtitleWords } from "./lib";

const GREEN = "#3DDC97";
const A = {
  hero: "a_nepkcb", // rewind.codes hero
  once: "a_aamouo", // "Software used to be written once"
  built: "a_aq8xrr", // "Built for code no human wrote" + feature cards
  docs: "a_e9jd72", // docs: What is Rewind (code sample)
  cards: "a_ltth0z", // Isolated on V8 · Re-testable · Plug into your harness
  music: "a_2wj5y6", // Sinny & 7vvch — Time Back
};
const END = f(26);
const shot = (assetId: string, from: number, to: number, props: Record<string, unknown>) => ({
  op: "add_clip" as const,
  track: "t_broll",
  clip: { type: "graphic" as const, component: "ScreenshotShowcase", start: f(from), duration: f(to) - f(from), props: { assetId, device: "browser", background: "dark", url: "rewind.codes", ...props } },
});
const gfx = (component: string, from: number, to: number, props: Record<string, unknown>) => ({
  op: "add_clip" as const,
  track: "t_gfx",
  clip: { type: "graphic" as const, component, start: f(from), duration: f(to) - f(from), props },
});

const words = subtitleWords([
  ["Your AI agent just wrote a workflow.", 0.3, 3.4],
  ["Nobody will ever read it.", 3.8, 5.6],
  ["So who runs it safely?", 5.7, 7.3],
  ["Rewind: a durable runtime for code no human wrote.", 7.6, 10.8],
  ["Every call to the outside world is journaled.", 11.1, 14.6],
  ["Sleep ten days. Crash. Resume exactly where it stopped.", 14.9, 18.4],
  ["Replay any run as a test, isolated in V8.", 18.7, 21.8],
]);

await edit(
  [
    ...(await clearOps()),
    shot(A.hero, 0, 3.7, { zoom: { x: 0.02, y: 0.6, w: 0.66, h: 0.3 }, zoomAt: 35 }),
    shot(A.once, 3.7, 7.5, { zoom: { x: 0.05, y: 0.1, w: 0.82, h: 0.52 }, zoomAt: 10 }),
    shot(A.built, 7.5, 11, { highlight: { x: 0.03, y: 0.1, w: 0.45, h: 0.28 }, highlightAt: 12, url: "rewind.codes/#built-for-agents" }),
    shot(A.docs, 11, 14.8, { zoom: { x: 0.24, y: 0.5, w: 0.52, h: 0.48 }, zoomAt: 12, url: "docs.rewind.codes" }),
    shot(A.built, 14.8, 18.6, { zoom: { x: 0.49, y: 0.66, w: 0.45, h: 0.33 }, zoomAt: 8 }),
    shot(A.cards, 18.6, 22, { highlight: { x: 0.3, y: 0.17, w: 0.42, h: 0.52 }, highlightAt: 10 }),
    shot(A.hero, 22, 26, { device: "none", tilt: false, float: false, zoom: { x: 0.32, y: 0.06, w: 0.66, h: 0.4 }, zoomAt: 0 }),
    gfx("Whip", 3.55, 3.9, { direction: "left" }),
    gfx("Flash", 7.4, 7.65, { color: "#3DDC97" }),
    gfx("Whip", 10.85, 11.2, { direction: "up" }),
    gfx("Whip", 14.65, 15, { direction: "left" }),
    gfx("Whip", 18.45, 18.8, { direction: "right" }),
    gfx("Counter", 15.2, 18.4, { from: 0, to: 10, suffix: " days", label: 'await sleep("10d")', position: "top", accent: GREEN }),
    gfx("Emoji", 19.3, 21.8, { emoji: "✅", x: 0.84, y: 0.27, size: 170 }),
    gfx("Title", 22.2, 26, { kicker: "DURABLE RUNTIME FOR AGENT CODE", text: "Rewind", subtitle: "rewind.codes", style: "elegant", accent: GREEN, size: 150 }),
    gfx("ProgressBar", 0, 26, { position: "top", color: GREEN, height: 10 }),
    { op: "add_clip", track: "t_caps", clip: { type: "captions", start: 0, duration: f(22.2), style: "bold", position: "bottom", color: GREEN, words } },
    { op: "add_clip", track: "t_music", clip: { type: "media", assetId: A.music, start: 0, duration: END, srcIn: 0, volume: 0.9, fadeIn: 10, fadeOut: 45 } },
  ],
  "Rewind explainer",
).then((r) => console.log(`rev ${r.revision}: ${r.summary.length} ops`));
