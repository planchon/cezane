import { ChevronDown, Clapperboard, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { brandUrl } from "../api";
import { PlansTab } from "../montage/Plans";
import { useApp } from "../store";
import { importFiles, renderVersion } from "./actions";
import { AssetsList } from "./AssetsPanel";

/**
 * Left panel, as in Figma UI3: the apple menu, the reel and its project, then two tabs.
 * "Plans" shows the montage (versions + shots) with the 9:16 frame and the timeline;
 * "Rushes" shows the project's media with the free canvas (tldraw).
 */
export function LeftPanel() {
  const { state, ui, setUi } = useApp();
  const folder = state?.dir.split("/").filter(Boolean).at(-1);
  return (
    <aside className="L">
      <div className="lh">
        <AppMenu />
      </div>
      <div className="file">
        <div className="t13 s ell" title={state?.project.name}>
          {state?.project.name ?? "Cezane"}
        </div>
        {folder && (
          <div className="sub ell" title={state?.dir}>
            {folder}
          </div>
        )}
      </div>
      <div className="tabs">
        <button className={`tab ${ui.tab === "montage" ? "on" : ""}`} onClick={() => setUi({ tab: "montage" })}>
          Plans
        </button>
        <button className={`tab ${ui.tab === "canvas" ? "on" : ""}`} onClick={() => setUi({ tab: "canvas" })}>
          Rushes
        </button>
      </div>
      {ui.tab === "montage" ? <PlansTab /> : <AssetsList />}
    </aside>
  );
}

function AppMenu() {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  const rendering = state?.versions.some((v) => v.status === "rendering");
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={`menu-btn ${open ? "on" : ""}`} onClick={() => setOpen((o) => !o)} title="Menu">
        <img src={brandUrl("logo-mark.png")} alt="Cezane" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="pop menu" style={{ top: 36, left: 0 }}>
          <button
            className="menu-item"
            onClick={() => {
              input.current?.click();
              setOpen(false);
            }}
          >
            <Upload size={16} /> Importer des fichiers…
          </button>
          <button
            className="menu-item"
            disabled={!state || rendering}
            onClick={() => {
              void renderVersion();
              setOpen(false);
            }}
          >
            <Clapperboard size={16} /> Rendre une nouvelle version
          </button>
        </div>
      )}
      <input ref={input} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => importFiles(Array.from(e.target.files ?? []))} />
    </div>
  );
}
