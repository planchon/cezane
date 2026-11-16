// Dax explainer: iOS simulator captures in an iPhone frame, subtitles only, trending music.
// Run with `cezane serve demo/dax` up: bun demo/scripts/dax.ts
import { clearOps, edit, f, subtitleWords } from "./lib";

const ORANGE = "#FF9500";
const A = {
  today: "a_9112yw",
  goals: "a_07bjfi",
  roadmap: "a_f50y1a",
  profile: "a_p556ud",
  workout: "a_ugwy41",
  roadmapScroll: "a_nfjr5i", // screen recording
  music: "a_14urln", // Tate McRae — Housewife
  painting: "a_c74oid", // Cézanne-style studio painting generated with Codex (assets/brand)
};
const END = f(24.5);
const shot = (assetId: string, from: number, to: number, props: Record<string, unknown>) => ({
  op: "add_clip" as const,
  track: "t_broll",
  clip: { type: "graphic" as const, component: "ScreenshotShowcase", start: f(from), duration: f(to) - f(from), props: { assetId, device: "iphone", ...props } },
});
const gfx = (component: string, from: number, to: number, props: Record<string, unknown>) => ({
  op: "add_clip" as const,
  track: "t_gfx",
  clip: { type: "graphic" as const, component, start: f(from), duration: f(to) - f(from), props },
});

const words = subtitleWords([
  ["Tu te fixes des objectifs… et tu lâches au bout d'une semaine ?", 0.3, 3.3],
  ["Voici Dax, ton coach pour les objectifs qui comptent vraiment.", 3.5, 6.7],
  ["Chaque jour, il te dit quoi faire : séance, eau, lecture.", 6.9, 10.3],
  ["Tes objectifs deviennent des programmes sur mesure.", 10.5, 13.9],
  ["Ta roadmap avance jour après jour.", 14.1, 17.4],
  ["Séries, trophées, badges : tu vois tes progrès.", 17.7, 20.9],
]);

await edit(
  [
    ...(await clearOps()),
    shot(A.today, 0, 3.5, { background: "cezanne" }),
    shot(A.today, 3.5, 6.9, { background: "provence", zoom: { x: 0.08, y: 0.0, w: 0.84, h: 0.4 }, zoomAt: 6 }),
    shot(A.today, 6.9, 10.5, { background: "ochre", highlight: { x: 0.02, y: 0.61, w: 0.96, h: 0.25 }, highlightAt: 10 }),
    shot(A.goals, 10.5, 14.1, { background: "sage", zoom: { x: 0.02, y: 0.08, w: 0.96, h: 0.34 }, zoomAt: 14 }),
    shot(A.roadmapScroll, 14.1, 17.7, { background: "prussian" }),
    shot(A.profile, 17.7, 21.1, { background: "terracotta", highlight: { x: 0.02, y: 0.5, w: 0.96, h: 0.29 }, highlightAt: 10 }),
    {
      op: "add_clip",
      track: "t_main",
      clip: { type: "media", assetId: A.painting, start: f(21.1), duration: END - f(21.1), zoom: { from: 1.08, to: 1.0, x: 0.5, y: 0.5, easing: "ease" } },
    },
    gfx("Emoji", 0.6, 3.3, { emoji: "😩", x: 0.83, y: 0.16, size: 190 }),
    gfx("Whip", 3.35, 3.7, { direction: "left" }),
    gfx("Emoji", 4.2, 6.7, { emoji: "🐶", x: 0.17, y: 0.15, size: 180 }),
    gfx("Whip", 6.75, 7.1, { direction: "up" }),
    gfx("Callout", 7.4, 10.3, { label: "Ta séance du jour", x: 0.62, y: 0.6, labelX: 0.5, labelY: 0.12, color: ORANGE }),
    gfx("Whip", 10.35, 10.7, { direction: "left" }),
    gfx("Whip", 13.95, 14.3, { direction: "right" }),
    gfx("Whip", 17.55, 17.9, { direction: "left" }),
    gfx("Counter", 18, 20.9, { from: 0, to: 12, suffix: " jours", label: "de série 🔥", position: "top", accent: ORANGE }),
    gfx("Flash", 21, 21.25, { color: "#FFF4E0" }),
    gfx("Title", 21.3, 24.5, { kicker: "TON COACH D'OBJECTIFS", text: "Dax", subtitle: "Commence aujourd'hui.", style: "elegant", accent: ORANGE, size: 170 }),
    gfx("ProgressBar", 0, 24.5, { position: "top", color: ORANGE, height: 10 }),
    { op: "add_clip", track: "t_caps", clip: { type: "captions", start: 0, duration: f(21), style: "box", position: "bottom", color: ORANGE, words } },
    { op: "add_clip", track: "t_music", clip: { type: "media", assetId: A.music, start: 0, duration: END, srcIn: 0, volume: 0.9, fadeIn: 8, fadeOut: 40 } },
  ],
  "Dax explainer",
).then((r) => console.log(`rev ${r.revision}: ${r.summary.length} ops`));
