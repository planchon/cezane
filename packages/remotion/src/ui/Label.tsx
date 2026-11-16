import { fonts, tracking } from "../fonts";
import { colors } from "../theme";
import { blurIn } from "./anim";

/** Small mono label in a frosted pill ("Dax · Aujourd'hui"). `dark` = for use over footage. */
export const Label: React.FC<{ text: string; k: number; t?: number; dark?: boolean }> = ({ text, k, t = 1, dark = false }) => (
  <div
    style={{
      ...blurIn(t, 30 * k),
      fontFamily: fonts.mono,
      fontWeight: 500,
      fontSize: 30 * k,
      letterSpacing: tracking.mono,
      lineHeight: 1,
      padding: `${12 * k}px ${22 * k}px`,
      borderRadius: 999,
      whiteSpace: "nowrap",
      color: dark ? colors.white : colors.ink,
      background: dark ? "rgba(20,20,18,0.42)" : "rgba(255,255,255,0.72)",
      backdropFilter: `blur(${12 * k}px)`,
      boxShadow: dark ? "none" : `0 ${2 * k}px ${10 * k}px rgba(0,0,0,0.06)`,
    }}
  >
    {text}
  </div>
);
