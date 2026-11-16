// Rewind docs video (16:9, for a docs or help page) from real browser recordings: scrolling the
// site, navigating the docs, searching. A Figma cursor replays the recorded clicks. No voice; the
// headlines carry the text, trending music underneath.
// Recordings: packages/engine/scripts/record-web.ts (Chrome + interaction log).
// Run with `cezane serve demo/rewind` up: bun demo/scripts/rewind.ts
import { clearOps, edit, f } from "./lib";

const A = {
  landing: "a_a8bhfm", // rewind.codes, slow scroll
  nav: "a_7643vy", // docs: click "How it works", scroll, click "The journal and replay"
  search: "a_wrxvct", // docs: open search, type "replay", Enter
  music: "a_2wj5y6", // Sinny & 7vvch — Time Back
};
const END = f(23.5);
const scene = (assetId: string, start: number, seconds: number, from: number, props: Record<string, unknown>) => ({
  op: "add_clip" as const,
  track: "t_broll",
  clip: { type: "graphic" as const, component: "ScreenshotShowcase", start: f(start), duration: f(seconds), props: { assetId, device: "browser", from, float: false, ...props } },
});
const gfx = (component: string, from: number, to: number, props: Record<string, unknown>) => ({
  op: "add_clip" as const,
  track: "t_gfx",
  clip: { type: "graphic" as const, component, start: f(from), duration: f(to) - f(from), props },
});

await edit(
  [
    ...(await clearOps()),
    { op: "set_settings", set: { width: 1920, height: 1080 } },
    scene(A.landing, 0, 4.5, 0.6, { background: "sea", url: "rewind.codes", label: "Rewind · Overview", caption: "A runtime for code", muted: "no human wrote." }),
    scene(A.nav, 4.5, 9.6, 0.4, { background: "sky", url: "docs.rewind.codes", label: "Docs · Get started", caption: "Read how it works,", muted: "then the journal." }),
    scene(A.search, 14.1, 6, 0.1, { background: "wall", url: "docs.rewind.codes", label: "Docs · Search", caption: "Find anything", muted: "in a keystroke." }),
    gfx("Plate", 20.1, 23.5, { background: "sea" }),
    gfx("Title", 20.2, 23.5, { style: "plain", scrim: false, kicker: "rewind.codes", text: "Rewind", muted: "Durable runtime for agent code.", position: "center", size: 130 }),
    { op: "add_clip", track: "t_music", clip: { type: "media", assetId: A.music, start: 0, duration: END, srcIn: 0, volume: 0.9, fadeIn: 10, fadeOut: 45 } },
  ],
  "Rewind docs video (enregistrements réels, 16:9)",
).then((r) => console.log(`rev ${r.revision}: ${r.summary.length} ops`));
