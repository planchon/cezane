import type { Comment, CommentStatus } from "@cezane/core";

export const timecode = (frame: number, fps: number) => {
  const total = Math.max(0, frame) / fps;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.max(0, Math.round(frame - Math.floor(total) * fps));
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
};

export const seconds = (frame: number, fps: number) => `${(frame / fps).toFixed(1)} s`;

/** "0:13.9": minutes, seconds and tenths, the way the UI shows times. */
export const clock = (frame: number, fps: number) => {
  const tenths = Math.floor((Math.max(0, frame) / fps) * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  return `${m}:${((tenths - m * 600) / 10).toFixed(1).padStart(4, "0")}`;
};

/** "0:13": minutes and seconds. */
export const clockShort = (frame: number, fps: number) => {
  const t = Math.floor(Math.max(0, frame) / fps + 1e-6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export const statusLabel: Record<CommentStatus, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  in_progress: "En cours",
  fixed: "Corrigé",
  validated: "Validé",
  reopened: "Rouvert",
};

/** Badge tone (.bd modifier) of each comment status. */
export const statusChip: Record<CommentStatus, string> = {
  draft: "",
  sent: "c",
  in_progress: "c",
  fixed: "g",
  validated: "",
  reopened: "o",
};

/** Comments that the next "Envoyer à Claude" sends. */
export const pendingForClaude = (cs: Comment[]) => cs.filter((c) => c.status === "draft" || c.status === "reopened");

export const relTime = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "à l'instant";
  if (d < 3600) return `il y a ${Math.round(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.round(d / 3600)} h`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

export const shortTool = (t?: string) => (t ?? "").replace(/^mcp__cezane__/, "");
