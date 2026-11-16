import type { ProjectSummary, ReelSummary } from "@cezane/core";
import { api, post } from "../api";
import { hasNativePicker, pickFolder } from "../native";
import { notAProject, useProjects } from "../projects";
import { askConfirm, askText } from "./Dialog";
import { attempt, toast } from "./toast";

type Projects = ReturnType<typeof useProjects>;

/** "Nouveau projet…": a name, then ~/Cezane/Projets/<nom>/ opened in a tab. */
export async function newProject(p: Projects) {
  const name = await askText({ title: "Nouveau projet", text: "Créé dans ~/Cezane/Projets.", label: "Nom", placeholder: "Mon projet", confirm: "Créer" });
  if (name) await attempt(() => p.createProject(name));
}

/**
 * "Ouvrir un dossier…": the macOS picker in the app, a path field in a browser. A folder without
 * cezane.json becomes a project only after asking.
 */
export async function openFolder(p: Projects) {
  const path = hasNativePicker()
    ? await pickFolder()
    : await askText({ title: "Ouvrir un dossier", text: "Un projet Cezane, ou un dossier à transformer en projet.", label: "Chemin du dossier", placeholder: "/Users/…/Mon projet", confirm: "Ouvrir" });
  if (!path) return;
  try {
    await p.openFolder(path);
  } catch (e) {
    if (!notAProject(e)) return toast(e instanceof Error ? e.message : String(e));
    const ok = await askConfirm({
      title: "Ce dossier n'est pas encore un projet",
      text: "Cezane y ajoute cezane.json et les dossiers Rushes, Générés, Captures et Exports. Les fichiers déjà présents ne bougent pas.",
      confirm: "En faire un projet",
    });
    if (ok) await attempt(() => p.openFolder(path, true));
  }
}

/** "Nouveau reel…" in the active project (or `projectId`): created empty, selected. */
export async function newReel(projectId?: string): Promise<ReelSummary | undefined> {
  const name = await askText({ title: "Nouveau reel", text: "Un montage vide au même format, dans ce projet.", label: "Nom", placeholder: "Mon reel", confirm: "Créer" });
  if (!name) return undefined;
  const path = projectId ? `/api/p/${encodeURIComponent(projectId)}/reels` : "/api/reels";
  return attempt(() => post<ReelSummary>(path, { name }));
}

export async function renameReel(reel: { id: string; name: string }) {
  const name = await askText({ title: "Renommer le reel", label: "Nom", value: reel.name, confirm: "Renommer" });
  if (name && name !== reel.name) await attempt(() => api("PATCH", `/api/reels/${encodeURIComponent(reel.id)}`, { name }));
}

export const selectReel = (id: string) => attempt(() => post(`/api/reels/${encodeURIComponent(id)}/select`));

/** The name shown for a reel: an unnamed "Montage" takes its project's name. */
export const reelTitle = (reel: { name: string }, project?: Pick<ProjectSummary, "name">) =>
  /^montage( \d+)?$/i.test(reel.name.trim()) && project ? project.name : reel.name;
