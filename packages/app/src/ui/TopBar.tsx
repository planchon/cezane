import type { ProjectSummary } from "@cezane/core";
import { FolderOpen, LayoutGrid, Plus, X } from "lucide-react";
import { useProjects } from "../projects";
import { usePopover } from "./Pickers";
import { newProject, openFolder } from "./projectActions";

/** Initial chips take one of these (terre cuite stays for Claude). */
const CHIP = ["#2f63d0", "#14ae5c", "#9747ff", "#dd7c0e", "#0d99a5", "#b86200"];
const chipColor = (id: string) => CHIP[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % CHIP.length];

/** The project's icon (icon.png in its folder), else its initial on a colored chip. */
export function ProjectIcon({ id, project, size = 16 }: { id: string; project?: ProjectSummary; size?: number }) {
  const name = project?.name ?? id;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.56) };
  if (project?.iconUrl) return <img className="pi" style={style} src={project.iconUrl} alt="" />;
  return (
    <span className="pi" style={{ ...style, background: chipColor(id) }}>
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

/**
 * The 40 px strip above everything: the home tab (grid), one tab per open project, then "+".
 * In Electron it is the window's drag region and leaves room on the left for the traffic lights.
 */
export function TopBar() {
  const { tabs, active, activate, close, summary } = useProjects();
  return (
    <header className="topbar">
      <button className={`ptab home ${active === null ? "on" : ""}`} title="Atelier : tous les projets" aria-label="Atelier" aria-current={active === null ? "page" : undefined} onClick={() => activate(null)}>
        <LayoutGrid size={16} />
      </button>
      <span className="tabsep" />
      <nav className="ptabs" role="tablist" aria-label="Projets ouverts">
        {tabs.map((t) => {
          const p = summary(t.id);
          const on = t.id === active;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={on}
              tabIndex={0}
              className={`ptab ${on ? "on" : ""} ${p?.missing ? "missing" : ""}`}
              title={p ? `${p.name}\n${p.path}` : t.id}
              onClick={() => activate(t.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && activate(t.id)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => {
                if (e.button === 1) close(t.id);
              }}
            >
              <ProjectIcon id={t.id} project={p} />
              <span className="ell">{p?.name ?? t.id}</span>
              {p?.claudeRunning && <span className="cl-dot" title="Claude travaille dans ce projet" />}
              <button
                className="x"
                aria-label={`Fermer ${p?.name ?? t.id}`}
                title="Fermer l'onglet (le projet reste dans l'Atelier)"
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </nav>
      <AddMenu />
    </header>
  );
}

/** "+": new project, open a folder, or one of the known projects not open in a tab. */
function AddMenu() {
  const projects = useProjects();
  const { open, setOpen, ref } = usePopover();
  const openIds = new Set(projects.tabs.map((t) => t.id));
  const others = (projects.projects ?? []).filter((p) => !openIds.has(p.id) && !p.missing).slice(0, 8);
  const run = (fn: () => unknown) => {
    setOpen(false);
    void fn();
  };
  return (
    <div className="addtab" ref={ref}>
      <button className={`ib ${open ? "on" : ""}`} aria-label="Ouvrir un projet" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus size={16} />
      </button>
      {open && (
        <div className="pop menu" role="menu" style={{ top: 30, left: 0 }}>
          <button role="menuitem" className="menu-item" onClick={() => run(() => newProject(projects))}>
            <Plus size={12} />
            Nouveau projet…
          </button>
          <button role="menuitem" className="menu-item" onClick={() => run(() => openFolder(projects))}>
            <FolderOpen size={12} />
            Ouvrir un dossier…
          </button>
          {others.length > 0 && (
            <>
              <div className="menu-sep" />
              <div className="menu-h c2">Projets</div>
              {others.map((p) => (
                <button key={p.id} role="menuitem" className="menu-item" onClick={() => run(() => projects.open(p.id))}>
                  <ProjectIcon id={p.id} project={p} size={14} />
                  <span className="ell">{p.name}</span>
                  <span className="c2 r">
                    {p.reels.length} reel{p.reels.length > 1 ? "s" : ""}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
