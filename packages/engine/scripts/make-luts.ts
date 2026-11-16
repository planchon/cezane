// Generates Cezane's built-in 3D LUTs (.cube, 33³) into assets/luts.
// bun packages/engine/scripts/make-luts.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "../src/proc";

type RGB = [number, number, number];
const N = 33;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** S-curve around `pivot`; `a` = strength (0 = none). Maps 0→0 and 1→1. */
const sCurve = (x: number, a: number, pivot = 0.45) => {
  if (a <= 0) return x;
  const s = (v: number) => 1 / (1 + Math.exp(-a * (v - pivot)));
  return (s(x) - s(0)) / (s(1) - s(0));
};
/** Lift the blacks and lower the whites (film fade). */
const levels = (x: number, black: number, white: number) => black + (white - black) * x;
/** Soft shoulder above `knee` so highlights roll off instead of clipping. */
const shoulder = (x: number, knee = 0.8) => (x <= knee ? x : knee + (1 - knee) * Math.tanh((x - knee) / (1 - knee)));
const saturate = (c: RGB, s: number): RGB => {
  const y = luma(c);
  return c.map((v) => y + (v - y) * s) as RGB;
};
/** Tints shadows and highlights with offsets (split toning). */
const splitTone = (c: RGB, shadow: RGB, high: RGB): RGB => {
  const y = luma(c);
  const ws = (1 - y) ** 2;
  const wh = y ** 2;
  return c.map((v, i) => v + shadow[i]! * ws + high[i]! * wh) as RGB;
};
const balance = (c: RGB, m: RGB): RGB => c.map((v, i) => v * m[i]!) as RGB;
const curve = (c: RGB, f: (x: number) => number): RGB => c.map(f) as RGB;

type Look = { title: string; fn: (c: RGB) => RGB };

const looks: Record<string, Look> = {
  // Contrasted, cool shadows and warm skin/highlights, a little desaturated: cinema drama.
  drame: {
    title: "Drame — contraste fort, ombres froides, hautes lumières chaudes",
    fn: (c) => {
      c = curve(c, (x) => x ** 1.2); // darker mids
      c = curve(c, (x) => sCurve(x, 6, 0.5));
      c = saturate(c, 0.84);
      c = splitTone(c, [-0.06, 0.0, 0.055], [0.055, 0.02, -0.045]);
      return curve(c, (x) => shoulder(levels(x, 0.0, 0.97), 0.72));
    },
  },
  // Film print: lifted blacks, warm mids, soft contrast and creamy highlights.
  film: {
    title: "Film — noirs relevés, tons chauds, hautes lumières douces",
    fn: (c) => {
      c = balance(c, [1.04, 1.01, 0.94]);
      c = curve(c, (x) => sCurve(x, 4.5, 0.48));
      c = splitTone(c, [0.0, 0.02, 0.025], [0.035, 0.02, -0.02]);
      c = saturate(c, 0.92);
      return curve(c, (x) => shoulder(levels(x, 0.045, 0.96), 0.75));
    },
  },
  // Golden Provence light: warm white balance, ochre and greens carried, gentle contrast.
  provence: {
    title: "Provence — lumière dorée, ocres et verts, contraste doux",
    fn: (c) => {
      c = balance(c, [1.07, 1.02, 0.88]);
      c = curve(c, (x) => sCurve(x, 3.8, 0.47));
      c = saturate(c, 1.08);
      c = splitTone(c, [0.01, 0.015, -0.01], [0.03, 0.015, -0.03]);
      return curve(c, (x) => shoulder(levels(x, 0.02, 0.99)));
    },
  },
  // Night: cold, contrasted, desaturated.
  nuit: {
    title: "Nuit — froid, contrasté, désaturé",
    fn: (c) => {
      c = balance(c, [0.93, 0.99, 1.08]);
      c = curve(c, (x) => sCurve(x, 7, 0.45));
      c = saturate(c, 0.68);
      c = splitTone(c, [-0.02, 0.01, 0.06], [-0.01, 0.01, 0.03]);
      return curve(c, (x) => shoulder(levels(x, 0.0, 0.97)));
    },
  },
  // Pastel: faded, soft, slightly pink highlights.
  pastel: {
    title: "Pastel — délavé, doux, hautes lumières rosées",
    fn: (c) => {
      c = curve(c, (x) => sCurve(x, 2.5, 0.5));
      c = saturate(c, 0.85);
      c = splitTone(c, [0.0, 0.03, 0.04], [0.04, 0.0, 0.02]);
      return curve(c, (x) => shoulder(levels(x, 0.08, 0.97), 0.7));
    },
  },
  // Black and white, high contrast.
  noir: {
    title: "Noir — noir et blanc contrasté",
    fn: (c) => {
      const y = clamp01(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]);
      const v = shoulder(sCurve(y, 7.5, 0.47));
      return [v, v, v];
    },
  },
};

const dir = join(REPO_DIR, "assets/luts");
mkdirSync(dir, { recursive: true });
for (const [name, look] of Object.entries(looks)) {
  const lines = [`TITLE "${look.title}"`, `LUT_3D_SIZE ${N}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let b = 0; b < N; b++)
    for (let g = 0; g < N; g++)
      for (let r = 0; r < N; r++) {
        const out = look.fn([r / (N - 1), g / (N - 1), b / (N - 1)]).map(clamp01);
        lines.push(out.map((v) => v.toFixed(5)).join(" "));
      }
  writeFileSync(join(dir, `${name}.cube`), `${lines.join("\n")}\n`);
  console.log(`${name}.cube`);
}
