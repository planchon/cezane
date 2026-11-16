/** Cézanne palette and backgrounds shared by every graphic. No React here: the server imports it via the catalog. */
export const palette = {
  cream: "#F3EDE0",
  paper: "#FBF7EE",
  ink: "#2B2A26",
  ochre: "#C8963E",
  gold: "#E8B04A",
  terracotta: "#B5573A",
  sage: "#8DA382",
  viridian: "#4E7A5A",
  prussian: "#3E6A8A",
  sky: "#9DB7C9",
  apple: "#B33A2E",
  plum: "#6B4E5E",
} as const;

/** Named backgrounds; any other string is used as a CSS background as-is. */
export const backgrounds: Record<string, string> = {
  cezanne: [
    "radial-gradient(ellipse 70% 45% at 18% 12%, rgba(157,183,201,0.95) 0%, rgba(157,183,201,0) 70%)",
    "radial-gradient(ellipse 60% 40% at 88% 22%, rgba(232,176,74,0.55) 0%, rgba(232,176,74,0) 70%)",
    "radial-gradient(ellipse 80% 45% at 15% 88%, rgba(78,122,90,0.9) 0%, rgba(78,122,90,0) 70%)",
    "radial-gradient(ellipse 60% 40% at 90% 85%, rgba(181,87,58,0.85) 0%, rgba(181,87,58,0) 70%)",
    "linear-gradient(165deg, #EDE3CC 0%, #DCC9A0 45%, #A9B48E 100%)",
  ].join(","),
  provence: [
    "radial-gradient(ellipse 90% 50% at 50% 0%, rgba(157,183,201,1) 0%, rgba(157,183,201,0) 75%)",
    "radial-gradient(ellipse 70% 40% at 30% 100%, rgba(200,150,62,0.9) 0%, rgba(200,150,62,0) 70%)",
    "linear-gradient(180deg, #C9D6DC 0%, #E7D9B5 55%, #C8963E 100%)",
  ].join(","),
  ochre: "linear-gradient(160deg, #E8B04A 0%, #C8963E 55%, #9C6B2A 100%)",
  sage: "linear-gradient(160deg, #B9C6A6 0%, #8DA382 50%, #4E7A5A 100%)",
  prussian: "linear-gradient(160deg, #5C86A3 0%, #3E6A8A 50%, #23415A 100%)",
  terracotta: "linear-gradient(160deg, #D27A5A 0%, #B5573A 55%, #7E3522 100%)",
  cream: "linear-gradient(180deg, #FBF7EE 0%, #F3EDE0 100%)",
  dark: "radial-gradient(ellipse 80% 60% at 50% 30%, #3A3832 0%, #1B1A17 100%)",
};

export const painted = (name: string) => name in backgrounds && name !== "cream" && name !== "dark";
export const resolveBackground = (bg: string) => backgrounds[bg] ?? bg;
