import type { Grade, MediaClip, Settings } from "./schema";

/** The grade a media clip gets: its own, else the montage look when the source is footage. */
export function effectiveGrade(clip: Pick<MediaClip, "grade">, settings: Pick<Settings, "grade">, footage: boolean): Grade | undefined {
  const g = clip.grade ?? (footage ? settings.grade : undefined);
  return g && g.lut !== "none" && g.intensity > 0 ? g : undefined;
}

/** Key of the graded copy of a file: the LUT and its strength (the vignette is drawn at render). */
export const gradeFileKey = (g: Grade) => `${g.lut}@${Math.round(g.intensity * 100)}`;
