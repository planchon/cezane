import type { PlateProps, WithDuration } from "../catalog";
import { Backdrop } from "../ui/Backdrop";

/** Full-frame painted plate (or flat background): end cards, chapter cards, behind text. */
export const Plate: React.FC<WithDuration<PlateProps>> = (p) => <Backdrop background={p.background} />;
