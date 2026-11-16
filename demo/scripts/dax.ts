// Dax onboarding / help video (vertical) from real simulator recordings: scrolls and taps in the
// app, a Figma cursor replaying the recorded interactions, painted plates, label + two-tone
// headline. No voice; the headlines carry the text, trending music underneath.
// Recordings: agent-device on the iOS simulator, with their interaction log (events.json).
// Run with `cezane serve demo/dax` up: bun demo/scripts/dax.ts
import { clearOps, edit, f } from "./lib";

const A = {
  today: "a_8u1qie", // scroll Today, then tap "Commencer" → workout sheet
  goals: "a_lf9iz1", // tab Objectifs, scroll
  roadmap: "a_9cvtui", // tab Roadmap, two scrolls
  profile: "a_ofd19x", // tab Profil, scroll
  music: "a_14urln", // Tate McRae — Housewife
};
const END = f(30.5);
/** A scene showing `seconds` of a recording from `from` (seconds into it). */
const scene = (assetId: string, start: number, seconds: number, from: number, props: Record<string, unknown>) => ({
  op: "add_clip" as const,
  track: "t_broll",
  clip: { type: "graphic" as const, component: "ScreenshotShowcase", start: f(start), duration: f(seconds), props: { assetId, device: "iphone", from, float: false, ...props } },
});
const gfx = (component: string, from: number, to: number, props: Record<string, unknown>) => ({
  op: "add_clip" as const,
  track: "t_gfx",
  clip: { type: "graphic" as const, component, start: f(from), duration: f(to) - f(from), props },
});

await edit(
  [
    ...(await clearOps()),
    { op: "set_settings", set: { width: 1080, height: 1920 } },
    scene(A.today, 0, 4.6, 1.2, { background: "sky", label: "Dax · Prise en main", caption: "Bienvenue", muted: "dans Dax." }),
    scene(A.today, 4.6, 5.2, 9.6, { background: "foliage", label: "1 · Ta séance", caption: "Lance ta séance", muted: "en un tap." }),
    scene(A.goals, 9.8, 5.8, 0.8, { background: "field", label: "2 · Objectifs", caption: "Tes objectifs,", muted: "en un coup d'œil." }),
    scene(A.roadmap, 15.6, 7, 4.8, { background: "sea", label: "3 · Roadmap", caption: "Ta roadmap", muted: "avance chaque jour." }),
    scene(A.profile, 22.6, 5.4, 2.4, { background: "dusk", label: "4 · Progrès", caption: "Tes séries,", muted: "tes trophées." }),
    gfx("Plate", 28, 30.5, { background: "sky" }),
    gfx("Title", 28.1, 30.5, { style: "ink", kicker: "Disponible sur iPhone", text: "Dax", muted: "Ton coach d'objectifs.", position: "center", size: 150 }),
    { op: "add_clip", track: "t_music", clip: { type: "media", assetId: A.music, start: 0, duration: END, srcIn: 0, volume: 0.9, fadeIn: 8, fadeOut: 40 } },
  ],
  "Dax onboarding (enregistrements réels)",
).then((r) => console.log(`rev ${r.revision}: ${r.summary.length} ops`));
