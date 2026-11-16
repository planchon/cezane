import { useEffect, useState } from "react";
import { brandUrl } from "./api";
import { CanvasView } from "./canvas/CanvasView";
import { ExportView } from "./export/ExportView";
import { MontageView } from "./montage/MontageView";
import { RightPanel } from "./panels/RightPanel";
import { useApp } from "./store";
import { importFiles } from "./ui/actions";
import { AssetsPane } from "./ui/AssetsPanel";
import { ReelPicker, ViewSwitcher } from "./ui/Pickers";
import { Toaster } from "./ui/toast";
import { TopBar } from "./ui/TopBar";

export function App() {
  const { state, error, connected, ui, setUi } = useApp();
  const [dragging, setDragging] = useState(false);
  const timeline = ui.view === "timeline";

  // Global shortcuts of the timeline (the canvas handles its own keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!timeline) return;
      const k = e.key.toLowerCase();
      if (k === "v") setUi({ tool: "select" });
      else if (k === "c") setUi({ tool: "comment" });
      else if (e.key === "Escape") setUi({ tool: "select" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeline, setUi]);

  // Files dropped anywhere on the timeline become assets (the Médias pane has its own drop zone).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || !timeline) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e) && timeline) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e) || !timeline) return;
      e.preventDefault();
      importFiles(Array.from(e.dataTransfer?.files ?? []));
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
  }, [timeline]);

  if (!state)
    return (
      <div className="boot">
        <img src={brandUrl("loading.gif")} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        <div>{error ? `Serveur Cezane injoignable (${error}). Lance \`cezane serve <projet>\`.` : "Chargement du projet…"}</div>
        <Toaster />
      </div>
    );

  // Top strip (future project tabs), then the work area: the view with its floating switcher, and the
  // right panel (not in Export). No left panel: versions live in the right panel's header.
  return (
    <div className="app">
      <TopBar />
      <div className="work">
        {ui.view === "medias" && <AssetsPane />}
        <div className="mid">
          {timeline ? <MontageView /> : ui.view === "medias" ? <CanvasView /> : <ExportView />}
          {timeline && <ReelPicker />}
          <ViewSwitcher />
        </div>
        {ui.view !== "export" && <RightPanel />}
      </div>
      {!connected && <div className="offline">Connexion au serveur perdue — reconnexion…</div>}
      {dragging && <div className="global-drop">Déposer pour importer dans le projet</div>}
      <Toaster />
    </div>
  );
}
