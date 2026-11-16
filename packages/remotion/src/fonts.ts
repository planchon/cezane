import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";
import { loadFont as loadInterTight } from "@remotion/google-fonts/InterTight";
import { loadFont as loadTikTokSans } from "@remotion/google-fonts/TikTokSans";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

const subsets = ["latin", "latin-ext"] as const;

const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF";

/**
 * Newsreader, self-hosted as a variable font with its optical sizes (opsz 6–72): the display cut
 * at title sizes, the text cut at caption sizes. OFL, files in public/fonts.
 */
const SERIF = "Newsreader Variable";
if (typeof document !== "undefined" && typeof FontFace !== "undefined") {
  const handle = delayRender("Loading Newsreader");
  const faces = [
    ["normal", "newsreader-latin.woff2", LATIN],
    ["normal", "newsreader-latin-ext.woff2", LATIN_EXT],
    ["italic", "newsreader-italic-latin.woff2", LATIN],
    ["italic", "newsreader-italic-latin-ext.woff2", LATIN_EXT],
  ].map(([style, file, range]) => {
    const f = new FontFace(SERIF, `url(${staticFile(`fonts/${file}`)}) format('woff2')`, { style, weight: "200 800", unicodeRange: range });
    document.fonts.add(f);
    return f.load();
  });
  Promise.all(faces)
    .then(() => continueRender(handle))
    .catch((e) => cancelRender(e));
}

/**
 * The type system: a serif for everything people read (titles, captions), a tight grotesk for
 * UI-like bits (cursor tags), a mono for small labels, and TikTok Sans for text that should look
 * typed in the TikTok app.
 */
export const fonts = {
  serif: SERIF,
  sans: loadInterTight("normal", { weights: ["500", "600", "700"], subsets: [...subsets] }).fontFamily,
  mono: loadGeistMono("normal", { weights: ["400", "500"], subsets: [...subsets] }).fontFamily,
  native: loadTikTokSans("normal", { weights: ["600", "700", "800"], subsets: [...subsets] }).fontFamily,
};

/** Letter spacing per family at display sizes. */
export const tracking = { display: "-0.02em", sans: "-0.045em", text: "-0.01em", mono: "-0.01em" } as const;

/** Style of the serif: optical sizes follow the font size. */
export const serif = (weight: number, italic = false) => ({
  fontFamily: SERIF,
  fontWeight: weight,
  fontStyle: italic ? ("italic" as const) : ("normal" as const),
  fontOpticalSizing: "auto" as const,
});
