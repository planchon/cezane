import { ChevronDown, Columns2, Film, LayoutDashboard, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { brandUrl, post } from "../api";
import { useApp } from "../store";
import { relTime } from "./format";
import { attempt } from "./toast";

export function TopBar() {
  const { state, ui, setUi, version, connected } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const versions = state?.versions ?? [];
  const running = state?.jobs.filter((j) => j.status === "running" || j.status === "queued") ?? [];
  const job = running[0];
  const claude = state?.claude;
  const rendering = versions.some((v) => v.status === "rendering");

  return (
    <header className="topbar">
      <div className="brand">
        <img src={brandUrl("logo-mark.png")} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
        <span className="word">Cezane</span>
        {state && <span className="proj" title={state.dir}>{state.project.name}</span>}
      </div>
      <div className="tabs">
        <button className={ui.tab === "montage" ? "on" : ""} onClick={() => setUi({ tab: "montage" })}>
          <Film size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
          Montage
        </button>
        <button className={ui.tab === "canvas" ? "on" : ""} onClick={() => setUi({ tab: "canvas" })}>
          <LayoutDashboard size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
          Canvas
        </button>
      </div>
      <div className="spacer" />
      {job && (
        <div className="jobs" title={running.map((j) => `${j.label} ${Math.round(j.progress * 100)} %`).join("\n")}>
          <span className="ring" style={{ "--p": job.progress } as React.CSSProperties} />
          <span>
            {job.label} · {Math.round(job.progress * 100)} %{running.length > 1 ? ` (+${running.length - 1})` : ""}
          </span>
        </div>
      )}
      <button
        className={`claude-dot ${!connected ? "off-line" : claude?.running ? "on" : ""}`}
        onClick={() => setUi({ panel: "claude" })}
        title={claude?.task ?? "Claude est disponible"}
      >
        <i />
        {claude?.running ? "Claude travaille" : "Claude"}
      </button>
      {ui.tab === "montage" && (
        <>
          <div className="dropdown" ref={ref}>
            <button className="btn" onClick={() => setOpen((o) => !o)} disabled={!versions.length}>
              {version ? `V${version.n}` : "Aucune version"}
              {version?.status === "rendering" && <Loader2 size={13} className="spin" />}
              <ChevronDown size={14} />
            </button>
            {open && (
              <div className="menu scroll" style={{ maxHeight: 420 }}>
                {[...versions].reverse().map((v) => (
                  <button
                    key={v.id}
                    className={`menu-item ${v.id === version?.id ? "on" : ""}`}
                    onClick={() => {
                      setUi({ versionId: v.id });
                      setOpen(false);
                    }}
                  >
                    <b>V{v.n}</b>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span className={`chip ${v.author === "claude" ? "terracotta" : "prussian"}`}>{v.author === "claude" ? "Claude" : "Moi"}</span>
                        {v.status === "rendering" ? (
                          <span className="chip ochre">rendu {Math.round(v.progress * 100)} %</span>
                        ) : v.status === "error" ? (
                          <span className="chip apple">erreur</span>
                        ) : null}
                        <span className="muted" style={{ fontSize: 11.5 }}>{relTime(v.createdAt)}</span>
                      </div>
                      <small>{v.summary || "—"}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={`btn ${ui.compare ? "primary" : ""}`}
            disabled={versions.length < 2}
            onClick={() => setUi((u) => ({ compare: !u.compare }))}
            title="Comparer deux versions côte à côte"
          >
            <Columns2 size={14} /> A/B
          </button>
        </>
      )}
      <button className="btn primary" disabled={rendering} onClick={() => attempt(() => post("/api/render", {}), "Rendu lancé")}>
        {rendering ? <Loader2 size={14} className="spin" /> : null}
        Rendre
      </button>
    </header>
  );
}
