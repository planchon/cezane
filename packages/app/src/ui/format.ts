import type { Comment, CommentStatus } from "@cezane/core";

export const timecode = (frame: number, fps: number) => {
  const total = Math.max(0, frame) / fps;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.max(0, Math.round(frame - Math.floor(total) * fps));
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
};

export const seconds = (frame: number, fps: number) => `${(frame / fps).toFixed(1)} s`;

export const statusLabel: Record<CommentStatus, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  in_progress: "En cours",
  fixed: "Corrigé",
  validated: "Validé",
  reopened: "Rouvert",
};

export const statusChip: Record<CommentStatus, string> = {
  draft: "apple",
  sent: "ochre",
  in_progress: "ochre",
  fixed: "sage",
  validated: "",
  reopened: "terracotta",
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
