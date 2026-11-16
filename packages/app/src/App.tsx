import { useEffect, useState } from "react";
import { uploadFiles } from "./api";
import { CanvasView } from "./canvas/CanvasView";
import { MontageView } from "./montage/MontageView";
import { RightPanel } from "./panels/RightPanel";
import { useApp } from "./store";
import { AssetsPanel } from "./ui/AssetsPanel";
import { attempt, Toaster } from "./ui/toast";
import { TopBar } from "./ui/TopBar";

export function App() {
  const { state, error, connected, ui, setUi } = useApp();
  const [dragging, setDragging] = useState(false);

  // Global shortcuts (the canvas handles its own keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ui.tab !== "montage") return;
      const k = e.key.toLowerCase();
      if (k === "v") setUi({ tool: "select" });
      else if (k === "h") setUi({ tool: "hand" });
      else if (k === "c") setUi({ tool: "comment" });
      else if (e.key === "Escape") setUi({ tool: "select" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui.tab, setUi]);

  // Files dropped anywhere on the montage screen become assets.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || ui.tab !== "montage") return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e) && ui.tab === "montage") e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e) || ui.tab !== "montage") return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) attempt(() => uploadFiles(files), `${files.length} fichier(s) importé(s)`);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [ui.tab]);

  if (!state)
    return (
      <div className="app">
        <TopBar />
        <div className="no-version" style={{ height: "100%" }}>
          <img src="/brand/loading.gif" alt="" style={{ width: 96, boxShadow: "none", mixBlendMode: "multiply" }} onError={(e) => (e.currentTarget.style.display = "none")} />
          <div>{error ? `Serveur Cezane injoignable (${error}). Lance \`cezane serve <projet>\`.` : "Chargement du projet…"}</div>
        </div>
        <Toaster />
      </div>
    );

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <AssetsPanel />
        <div className="main">{ui.tab === "montage" ? <MontageView /> : <CanvasView />}</div>
        <RightPanel />
      </div>
      {!connected && <div className="offline chip apple">Connexion au serveur perdue — reconnexion…</div>}
      {dragging && <div className="global-drop">Déposer pour importer dans le projet</div>}
      <Toaster />
    </div>
  );
}
