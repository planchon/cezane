/** The "Studio" look shared by every graphic. No React here: the server imports it via the catalog. */
export const colors = {
  ink: "#2A2A27", // text on light backgrounds
  muted: "#8A8880", // second tone, labels
  paper: "#F1F0EB",
  white: "#FFFFFF",
  night: "#161615",
  accent: "#0A84FF", // cursor, focus rings
  marker: "rgba(255,176,0,0.5)", // highlighter behind a word
} as const;

/**
 * Painted plates: Cézanne-style textures generated with Codex, shown blurred with grain
 * (files in public/plates). They carry the painter's palette without any gradient pastiche.
 */
export const plates = ["sky", "field", "foliage", "wall", "sea", "dusk"] as const;
export type Plate = (typeof plates)[number];

/** Flat and soft backgrounds; any other string is used as a CSS background as-is. */
export const flatBackgrounds: Record<string, string> = {
  paper: colors.paper,
  white: colors.white,
  night: colors.night,
  lavender: "linear-gradient(180deg, #F7F7F5 0%, #F2F0F6 55%, #E9E3F4 100%)",
  mint: "linear-gradient(180deg, #F6F8F3 0%, #EDF3EA 55%, #DCE9D8 100%)",
  peach: "linear-gradient(180deg, #FAF6F1 0%, #F7EBE1 55%, #F1D9C8 100%)",
};

/** Names used before the Studio look, kept so older montages still render. */
const legacy: Record<string, string> = {
  cezanne: "field",
  provence: "sky",
  ochre: "field",
  sage: "foliage",
  prussian: "sea",
  terracotta: "dusk",
  cream: "paper",
  dark: "night",
};

export type ResolvedBackground = { plate: Plate } | { css: string };

export function resolveBackground(name: string): ResolvedBackground {
  const n = legacy[name] ?? name;
  if ((plates as readonly string[]).includes(n)) return { plate: n as Plate };
  return { css: flatBackgrounds[n] ?? n };
}

/** True when dark text reads well on this background. */
export function isLight(name: string): boolean {
  const n = legacy[name] ?? name;
  return n !== "night" && n !== "sea" && !/^#(0|1|2|3)/i.test(n);
}

export const backgroundNames = [...plates, ...Object.keys(flatBackgrounds)];

/** True for light hex colors (#RGB or #RRGGBB); anything else counts as dark. */
export function isLightColor(c: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return false;
  const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.6;
}
