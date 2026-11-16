import type { Version } from "@cezane/core";
import { ChartGantt, Check, ChevronDown, Images, Loader2, Send } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useApp, type View } from "../store";
import { clockShort, relTime } from "./format";

/** Open state of a popover that closes on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// ───────────────────────── view switcher ─────────────────────────

const views: { id: View; label: string; Icon: typeof Send }[] = [
  { id: "timeline", label: "Timeline", Icon: ChartGantt },
  { id: "medias", label: "Médias", Icon: Images },
  { id: "export", label: "Export", Icon: Send },
];

/** Floating pill centred at the top of the work area: Timeline, Médias, Export. */
export function ViewSwitcher() {
  const { ui, setUi } = useApp();
  return (
    <div className="vsw" role="tablist" aria-label="Vue">
      {views.map(({ id, label, Icon }) => (
        <button key={id} role="tab" aria-selected={ui.view === id} className={ui.view === id ? "on" : ""} onClick={() => setUi({ view: id })}>
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── reel (montage) ─────────────────────────

/**
 * Floating pill at the top-left of the work area: the current montage and how many the project has.
 * The server serves one montage (project.montages[0]) and has no route to open or create another, so
 * the menu lists the reels and marks the open one; switching arrives with the multi-project backend.
 */
export function ReelPicker() {
  const { state } = useApp();
  const { open, setOpen, ref } = usePopover();
  if (!state) return null;
  const reels = state.project.montages.length ? state.project.montages : [{ id: state.montage.id, name: state.montage.name }];
  const current = state.montage;
  const n = reels.length;
  return (
    <div className="reel" ref={ref}>
      <button className={`reel-btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <span className="s ell">{current.name || reels.find((r) => r.id === current.id)?.name || "Montage"}</span>
        <ChevronDown size={12} />
        <span className="c3 n">
          {n} reel{n > 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <div className="pop menu" role="menu" style={{ top: 44, left: 0 }}>
          {reels.map((r) => {
            const on = r.id === current.id;
            return (
              <button
                key={r.id}
                role="menuitemradio"
                aria-checked={on}
                className="menu-item"
                disabled={!on}
                title={on ? undefined : "Le serveur n'ouvre qu'un reel à la fois pour l'instant"}
                onClick={() => setOpen(false)}
              >
                <span className="chk">{on && <Check size={12} />}</span>
                <span className="ell">{r.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── version ─────────────────────────

/** "il y a 10 min", the render progress, or the failure. */
export function versionWhen(v: Version): string {
  if (v.status === "rendering") return `rendu ${Math.round(v.progress * 100)} %`;
  if (v.status === "error") return "échec du rendu";
  return relTime(v.createdAt);
}

/** "V2 · il y a 10 min ▾": picks the displayed version (shared by the right panel and Export). */
export function VersionPicker({ align = "left", empty = "Aucune version" }: { align?: "left" | "right"; empty?: ReactNode }) {
  const { state, version, setUi } = useApp();
  const { open, setOpen, ref } = usePopover();
  const versions = state?.versions ?? [];
  if (!version) return <span className="btn" aria-disabled="true">{empty}</span>;
  return (
    <div className="vpick" ref={ref}>
      <button className={`btn ${open ? "open" : ""}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={version.summary || undefined}>
        V{version.n}
        <span className="c2 when">{versionWhen(version)}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="pop menu vmenu scroll" role="menu" style={{ top: 28, [align]: 0 }}>
          {[...versions].reverse().map((v) => {
            const on = v.id === version.id;
            return (
              <button
                key={v.id}
                role="menuitemradio"
                aria-checked={on}
                className="menu-item tall"
                onClick={() => {
                  setUi({ versionId: v.id });
                  setOpen(false);
                }}
              >
                <span className="chk">{on && <Check size={12} />}</span>
                <span className="vtxt">
                  <span className="vrow">
                    <span className="s">V{v.n}</span>
                    <span className="c2">
                      {v.status === "rendering" && <Loader2 size={10} className="spin" />} {versionWhen(v)}
                      {v.status === "ready" ? ` · ${clockShort(v.durationFrames, v.fps)}` : ""}
                    </span>
                    <span className={`c2 by ${v.author === "claude" ? "cl" : ""}`}>{v.author === "claude" ? "Claude" : "Toi"}</span>
                  </span>
                  {v.summary && <span className="c2 sum">{v.summary}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
