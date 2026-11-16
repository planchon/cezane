import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";

const subsets = ["latin", "latin-ext"] as const;

/** Display = TikTok-style punchy text, ui = labels, serif = elegant titles. */
export const fonts = {
  display: loadMontserrat("normal", { weights: ["700", "800", "900"], subsets: [...subsets] }).fontFamily,
  ui: loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: [...subsets] }).fontFamily,
  serif: loadFraunces("normal", { weights: ["500", "600", "700", "900"], subsets: [...subsets] }).fontFamily,
};
