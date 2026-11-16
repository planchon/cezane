import { post, uploadFiles } from "../api";
import { attempt } from "./toast";

/** Renders the current montage as a new version. */
export const renderVersion = () => attempt(() => post("/api/render", {}), "Rendu lancé");

/** Imports files into the project as assets. */
export const importFiles = (files: File[]) => {
  if (files.length) void attempt(() => uploadFiles(files), `${files.length} fichier(s) importé(s)`);
};
