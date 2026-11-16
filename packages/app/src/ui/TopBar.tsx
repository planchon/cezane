import { LayoutGrid } from "lucide-react";
import { brandUrl } from "../api";
import { useApp } from "../store";

/** One open project. Phase 2 (multi-project server) fills this list; today it holds the served project. */
export type ProjectTab = { id: string; name: string; path?: string; icon?: string; active: boolean };

/**
 * The 40 px strip above everything (future tab bar). In Electron it is the window's drag region and
 * leaves room on the left for the traffic lights (titleBarStyle hiddenInset, see electron/main.ts).
 */
export function TopBar() {
  const { state } = useApp();
  const tabs: ProjectTab[] = state ? [{ id: state.dir, name: state.project.name, path: state.dir, icon: brandUrl("app-icon.png"), active: true }] : [];
  return (
    <header className="topbar">
      <button className="ptab home" title="Projets (bientôt)" aria-disabled="true">
        <LayoutGrid size={16} />
      </button>
      <span className="tabsep" />
      <nav className="ptabs" aria-label="Projets ouverts">
        {tabs.map((t) => (
          <Tab key={t.id} tab={t} />
        ))}
      </nav>
    </header>
  );
}

function Tab({ tab }: { tab: ProjectTab }) {
  return (
    <button className={`ptab ${tab.active ? "on" : ""}`} title={tab.path} aria-current={tab.active ? "page" : undefined}>
      {tab.icon ? (
        <img className="pi" src={tab.icon} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
      ) : (
        <span className="pi">{tab.name.slice(0, 1).toUpperCase()}</span>
      )}
      <span className="ell">{tab.name}</span>
    </button>
  );
}
