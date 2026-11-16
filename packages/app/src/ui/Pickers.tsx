import type { ReelSummary, Version } from "@cezane/core";
import { ChartGantt, Check, ChevronDown, Images, Loader2, Pencil, Plus, Send } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useApp, type View } from "../store";
import { clockShort, relTime } from "./format";
import { failureLabel } from "./RenderFailure";
import { newReel, renameReel, selectReel } from "./projectActions";

/** Open state of a popover that closes on an outside click or Escape. */
export function usePopover() {
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
 * Floating pill at the top-left of the work area: the selected reel and how many the project has.
 * The menu switches reel (the server selects it for the project: state, edits, renders, comments and
 * new Claude sessions follow), creates one or renames the current one.
 */
export function ReelPicker() {
  const { state } = useApp();
  const { open, setOpen, ref } = usePopover();
  if (!state) return null;
  const reels: Pick<ReelSummary, "id" | "name" | "lastVersion" | "versions">[] = state.reels?.length
    ? state.reels
    : (state.project.montages.length ? state.project.montages : [state.montage]).map((m) => ({ id: m.id, name: m.name, versions: -1 }));
  const current = state.montage;
  const n = reels.length;
  const claudeOn = state.claude.running ? (state.claude.montageId ?? current.id) : undefined;
  const run = (fn: () => unknown) => {
    setOpen(false);
    void fn();
  };
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
        <div className="pop menu reelmenu" role="menu" style={{ top: 44, left: 0 }}>
          {reels.map((r) => {
            const on = r.id === current.id;
            const info = r.versions < 0 ? "" : r.lastVersion ? `V${r.lastVersion.n}` : "Rushes";
            return (
              <button key={r.id} role="menuitemradio" aria-checked={on} className="menu-item" onClick={() => run(() => !on && selectReel(r.id))}>
                <span className="chk">{on && <Check size={12} />}</span>
                <span className="ell">{r.name}</span>
                {r.id === claudeOn && <span className="cl-dot" title="Claude travaille sur ce reel" />}
                <span className="c2 r">{info}</span>
              </button>
            );
          })}
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item" onClick={() => run(() => newReel())}>
            <span className="chk">
              <Plus size={12} />
            </span>
            Nouveau reel…
          </button>
          <button role="menuitem" className="menu-item" onClick={() => run(() => renameReel({ id: current.id, name: current.name }))}>
            <span className="chk">
              <Pencil size={12} />
            </span>
            Renommer « {current.name} »…
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── version ─────────────────────────

/** "il y a 10 min", the render progress, or the failure. */
export function versionWhen(v: Version): string {
  if (v.status === "rendering") return `rendu ${Math.round(v.progress * 100)} %`;
  if (v.status === "error") return failureLabel(v);
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
                  setUi({ versionId: v.id, compareId: undefined });
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
                    {v.status === "error" && (
                      <span className="fail-chip" title="Voir pourquoi le rendu a échoué et le réparer">
                        Réparer
                      </span>
                    )}
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
