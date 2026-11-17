import type { SetupItem, SetupState } from "@cezane/core";
import { Check, Copy, Download, RotateCw, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, get } from "../api";
import { toast } from "./toast";

/**
 * « Préparer Cezane »: the tools Cezane relies on. A compact card on the Atelier while something
 * required is missing, and the same list in a dialog (Atelier sidebar) to check again later.
 */

let show: (() => void) | undefined;

/** Opens the dialog (from the Atelier sidebar). */
export function openSetup() {
  show?.();
}

// One state shared by the card, the sidebar entry and the dialog.
let current: SetupState | undefined;
let checking = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

async function load(fresh = false) {
  if (fresh) {
    checking = true;
    emit();
  }
  try {
    current = await get<SetupState>(`/api/setup${fresh ? "?fresh=1" : ""}`);
  } catch {
    // Server unreachable (or the mock): no card rather than a wrong one.
  } finally {
    checking = false;
    emit();
  }
}

async function act(method: string, path: string) {
  try {
    current = await api<SetupState>(method, path);
    emit();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

/** The setup state: fetched on mount, checked again when the window comes back (after a Terminal install), every second while a download runs. */
export function useSetup() {
  const state = useSyncExternalStore(subscribe, () => current);
  const busy = useSyncExternalStore(subscribe, () => checking);
  useEffect(() => {
    if (!current) void load();
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const running = state?.items.some((i) => i.download?.state === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [running]);
  return { state, checking: busy, recheck: () => load(true), act };
}

const missingRequired = (s: SetupState) => s.items.filter((i) => i.need === "required" && !i.ok).length;

/** On the Atelier while a required tool is missing. */
export function SetupCard({ setup }: { setup: ReturnType<typeof useSetup> }) {
  const s = setup.state;
  if (!s || s.ready) return null;
  const n = missingRequired(s);
  return (
    <section className="su-card" aria-label="Préparer Cezane">
      <div className="su-head">
        <div className="ell">
          <div className="t13 s">Préparer Cezane</div>
          <div className="c2 ell">{n > 1 ? `${n} éléments manquent` : "Un élément manque"} avant ton premier montage.</div>
        </div>
        <button className="btn" onClick={() => void setup.recheck()} disabled={setup.checking}>
          <RotateCw size={14} className={setup.checking ? "spin" : undefined} />
          Vérifier à nouveau
        </button>
      </div>
      <SetupBody setup={setup} optional="line" />
    </section>
  );
}

/** The dialog: every item, optional ones in full. */
export function SetupHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    show = () => setOpen(true);
    return () => {
      show = undefined;
    };
  }, []);
  if (!open) return null;
  return <SetupDialog close={() => setOpen(false)} />;
}

function SetupDialog({ close }: { close: () => void }) {
  const setup = useSetup();
  const s = setup.state;
  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dlg pop pm su-dlg" role="dialog" aria-modal="true" aria-label="Préparer Cezane" onKeyDown={(e) => e.key === "Escape" && close()} tabIndex={-1}>
        <div className="pm-head">
          <div className="t13 s">Préparer Cezane</div>
          <button className="ib" onClick={close} aria-label="Fermer" autoFocus>
            <X size={16} />
          </button>
        </div>
        <p className="c2 pm-intro">{!s ? "Vérification…" : s.ready ? "Tout ce qu'il faut pour monter est là." : `${missingRequired(s) > 1 ? "Des éléments manquent" : "Un élément manque"} pour monter.`}</p>
        {s && (
          <div className="su-dlg-body">
            <SetupBody setup={setup} optional="rows" />
          </div>
        )}
        <div className="su-foot">
          <span className="c2">{s ? `Vérifié à ${new Date(s.checkedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
          <button className="btn" onClick={() => void setup.recheck()} disabled={setup.checking}>
            <RotateCw size={14} className={setup.checking ? "spin" : undefined} />
            Vérifier à nouveau
          </button>
        </div>
      </div>
    </div>
  );
}

function SetupBody({ setup, optional }: { setup: ReturnType<typeof useSetup>; optional: "line" | "rows" }) {
  const s = setup.state!;
  const main = s.items.filter((i) => i.need !== "optional");
  const extra = s.items.filter((i) => i.need === "optional");
  return (
    <>
      <div className="su-list">
        {main.map((i) => (
          <Row key={i.id} item={i} act={setup.act} />
        ))}
      </div>
      {s.commands.length > 0 && (
        <div className="su-cmds">
          <div className="c2">Dans le Terminal, dans l'ordre :</div>
          {s.commands.map((c) => (
            <Command key={c.command} label={c.label} command={c.command} />
          ))}
          {s.commands.some((c) => c.command === "claude") && <div className="c2">La dernière ouvre Claude Code : connecte-toi avec ton compte Claude, puis quitte-le.</div>}
        </div>
      )}
      {optional === "line" ? (
        <div className="su-opt c2">
          <span>Optionnel :</span>
          {extra.map((i) => (
            <span key={i.id} className={`su-chip ${i.ok ? "ok" : ""}`} title={`${i.unlocks ?? ""} · ${i.detail}`}>
              {i.ok ? <Check size={12} /> : null}
              {i.label}
            </span>
          ))}
        </div>
      ) : (
        <>
          <div className="pm-sh su-sh">Optionnel</div>
          <div className="su-list">
            {extra.map((i) => (
              <Row key={i.id} item={i} act={setup.act} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Row({ item: i, act }: { item: SetupItem; act: (method: string, path: string) => Promise<void> }) {
  const d = i.download;
  const running = d?.state === "running";
  const pct = d && d.total ? Math.round((d.received / d.total) * 100) : 0;
  const route = i.id === "model" ? "/api/setup/model" : i.id === "renderer" ? "/api/setup/renderer" : undefined;
  const mark = i.ok ? "ok" : i.need === "required" ? "ko" : "off";
  return (
    <div className="su-row">
      <span className={`su-mark ${mark}`} aria-label={i.ok ? "présent" : "absent"}>
        {i.ok ? <Check size={12} /> : i.need === "required" ? <X size={12} /> : null}
      </span>
      <span className="su-txt">
        <span className="s ell">{i.label}</span>
        <span className={`ell ${d?.state === "error" ? "su-err" : "c2"}`} title={d?.error ?? i.unlocks ?? i.detail}>
          {d?.state === "error" ? `Échec : ${d.error}` : i.need === "optional" && i.unlocks ? `${i.unlocks} · ${i.detail}` : i.detail}
        </span>
      </span>
      {!i.ok && route && running && (
        <span className="su-prog">
          <span className="hm-bar-p">
            <i style={{ width: `${Math.max(2, pct)}%` }} />
          </span>
          <span className="c2">{pct} %</span>
          {i.id === "model" && (
            <button className="ib" title="Annuler le téléchargement" aria-label="Annuler le téléchargement" onClick={() => void act("DELETE", route)}>
              <X size={14} />
            </button>
          )}
        </span>
      )}
      {!i.ok && route && !running && (
        <button className={`btn ${i.id === "model" ? "pri" : ""}`} onClick={() => void act("POST", route)}>
          <Download size={14} />
          {d?.state === "error" ? "Réessayer" : i.id === "model" ? "Télécharger" : "Télécharger maintenant"}
        </button>
      )}
    </div>
  );
}

function Command({ label, command }: { label: string; command: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const t = document.createElement("textarea");
      t.value = command;
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    toast("Commande copiée");
  };
  return (
    <div className="su-cmd">
      <span className="c2 su-cl">{label}</span>
      <code className="ell" title={command}>
        {command}
      </code>
      <button className="ib" onClick={() => void copy()} title="Copier" aria-label={`Copier : ${command}`}>
        <Copy size={14} />
      </button>
    </div>
  );
}
