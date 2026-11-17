import type { Montage, RenderFailure, Version } from "@cezane/core";
import { CircleAlert, CirclePause, Clapperboard, Copy, FileX2, FolderSearch, Loader2, RotateCcw, Scissors, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isMock, post, scopedPath } from "../api";
import { useApp } from "../store";
import { renderVersion } from "./actions";
import { askConfirm } from "./Dialog";
import { attempt, toast } from "./toast";
import "./failure.css";

/**
 * A failed render: what went wrong (classified by the server, see RenderFailure) and the action that
 * fixes it. Nothing starts on its own: the user clicks.
 *   missing     → Relier le fichier (Médias, on its folder) · Retirer le plan
 *   interrupted → Relancer le rendu
 *   technical   → Réparer avec Claude (· Relancer le rendu when it looks transient)
 *   always      → Voir le détail (error + end of the render log, copy)
 */

const baseName = (p: string) => p.split("/").at(-1) ?? p;
const dirOf = (p: string) => p.split("/").slice(0, -1).join("/");
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** The failure of a version (versions failed before failures were classified only have `error`). */
export function failureOf(v: Version): RenderFailure {
  return v.failure ?? { kind: v.error === "interrupted" ? "interrupted" : "technical", message: v.error ?? "Le rendu a échoué." };
}

/** "fichier introuvable", "rendu interrompu", "échec du rendu": the version menus. */
export function failureLabel(v: Version): string {
  const k = failureOf(v).kind;
  return k === "missing" ? "fichier introuvable" : k === "interrupted" ? "rendu interrompu" : "échec du rendu";
}

/** Clips of the montage that use an asset (media clips, graphics taking it in their props). */
function clipsUsing(m: Montage | undefined, assetIds: string[]): number {
  if (!m || !assetIds.length) return 0;
  return m.tracks.flatMap((t) => t.clips).filter((c) => {
    const json = JSON.stringify(c);
    return assetIds.some((id) => json.includes(`"${id}"`));
  }).length;
}

type Step = "retry" | "render" | "relink" | "remove" | "repair";

/** The failure card: in the Export status section (`panel`) or on the empty Timeline stage (`stage`). */
export function FailureCard({ version: v, variant = "panel", kicker = variant === "stage" }: { version: Version; variant?: "panel" | "stage"; kicker?: boolean }) {
  const { state, setUi } = useApp();
  const [busy, setBusy] = useState<Step>();
  const [detail, setDetail] = useState(false);
  const f = failureOf(v);
  const claude = state?.claude;
  const repairing = Boolean(claude?.running && claude.repairing === v.id);
  const claudeBusy = Boolean(claude?.running && !repairing);

  // Missing files: which are still gone, and whether the montage still uses them.
  const assets = state?.project.assets ?? [];
  const files = (f.assetIds ?? []).map((id) => {
    const a = assets.find((x) => x.id === id);
    return { id, name: a ? baseName(a.file) : id, dir: a ? dirOf(a.file) : "", back: Boolean(a && !a.missing) };
  });
  const gone = files.filter((x) => !x.back);
  const goneIds = gone.map((x) => x.id);
  const used = useMemo(() => clipsUsing(state?.montage, goneIds), [state?.montage, goneIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (step: Step, fn: () => Promise<unknown>) => {
    setBusy(step);
    await fn();
    setBusy(undefined);
  };
  const retry = () => run("retry", () => attempt(() => post(`/api/versions/${v.id}/retry`), `Rendu de V${v.n} relancé`));
  const renderNew = () =>
    run("render", async () => {
      await renderVersion();
      setUi({ versionId: undefined });
    });
  const repair = () =>
    run("repair", async () => {
      const ok = await attempt(() => post(`/api/versions/${v.id}/repair`));
      if (ok) setUi({ panel: "claude" });
    });
  const relink = () => setUi({ view: "medias", reveal: gone[0]?.id });
  const remove = () =>
    run("remove", async () => {
      const names = gone.map((x) => x.name).join(", ");
      const yes = await askConfirm({
        title: `Retirer ${used} ${plural(used, "plan", "plans")} ?`,
        text: `${plural(used, "Le plan qui utilise", "Les plans qui utilisent")} ${names} ${plural(used, "sort", "sortent")} du montage. Le reste ne bouge pas.`,
        confirm: "Retirer",
      });
      if (!yes) return;
      const r = await attempt(() => post<{ removed: number }>(`/api/versions/${v.id}/remove-clips`, { assetIds: goneIds }));
      if (r) toast(`${r.removed} ${plural(r.removed, "plan retiré", "plans retirés")} du montage`);
    });

  // What the card says and offers, by kind and by what changed since (file back, clips removed, Claude working).
  let icon = <CircleAlert size={16} className="err" />;
  let title = "Erreur technique";
  let text: React.ReactNode = <span className="fail-raw">{f.message}</span>;
  let actions: React.ReactNode = null;
  const btn = (step: Step, label: string, onClick: () => void, cls = "", Icon = RotateCcw, disabled = false, tip?: string) => (
    <button className={`btn ${cls}`} disabled={Boolean(busy) || disabled} onClick={onClick} title={tip}>
      {busy === step ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
      {label}
    </button>
  );

  if (repairing) {
    icon = <Loader2 size={16} className="spin cl" />;
    title = `Claude répare V${v.n}`;
    text = "Il cherche la cause dans le montage et la corrige. Le rendu repart dès qu'il a fini.";
    actions = (
      <button className="btn" onClick={() => setUi({ view: "timeline", panel: "claude" })}>
        <Sparkles size={16} />
        Suivre dans l'onglet Claude
      </button>
    );
  } else if (f.kind === "missing" && files.length && !gone.length) {
    icon = <RotateCcw size={16} className="ok" />;
    title = plural(files.length, "Fichier retrouvé", "Fichiers retrouvés");
    text = `Tout est de nouveau là : relance le rendu de V${v.n}.`;
    actions = btn("retry", "Relancer le rendu", retry, "pri");
  } else if (f.kind === "missing" && gone.length && !used) {
    icon = <Scissors size={16} className="c3" />;
    title = plural(gone.length, "Plan retiré", "Plans retirés");
    text = `Le montage n'utilise plus ${plural(gone.length, "ce fichier", "ces fichiers")}. Rends une nouvelle version.`;
    actions = btn("render", "Rendre le montage", renderNew, "pri", Clapperboard);
  } else if (f.kind === "missing") {
    icon = <FileX2 size={16} className="err" />;
    title = plural(gone.length, "Fichier introuvable", "Fichiers introuvables");
    text = (
      <>
        V{v.n} utilise {plural(gone.length, "un fichier supprimé ou déplacé", "des fichiers supprimés ou déplacés")} dans le Finder.
        <span className="fail-files">
          {gone.map((x) => (
            <span key={x.id} className="fail-file" title={`${x.dir}/${x.name}`}>
              <FileX2 size={12} />
              <span className="ell">{x.name}</span>
              <span className="c2 ell r">{x.dir}/</span>
            </span>
          ))}
        </span>
      </>
    );
    actions = (
      <>
        {btn("relink", plural(gone.length, "Relier le fichier", "Relier les fichiers"), relink, "pri", FolderSearch)}
        {btn("remove", `Retirer ${plural(used, "le plan", `les ${used} plans`)}`, remove, "", Scissors)}
      </>
    );
  } else if (f.kind === "interrupted") {
    icon = <CirclePause size={16} className="warn" />;
    title = "Rendu interrompu";
    text = `Cezane s'est fermé pendant le rendu de V${v.n}.`;
    actions = btn("retry", "Relancer le rendu", retry, "pri");
  } else {
    actions = (
      <>
        {btn("repair", "Réparer avec Claude", repair, "cl", Sparkles, claudeBusy, claudeBusy ? "Claude travaille déjà : attends qu'il ait fini" : "Claude lit l'erreur, corrige le montage, puis relance le rendu")}
        {f.transient && btn("retry", "Relancer le rendu", retry)}
      </>
    );
    text = (
      <>
        <span className="fail-raw">{f.message}</span>
        <span className="c2">{f.transient ? "Ça ressemble à un incident passager : relancer peut suffire." : "Claude peut trouver la cause dans le montage et la corriger."}</span>
      </>
    );
  }

  return (
    <div className={`fail fail-${variant}`}>
      {kicker && <div className="c2 fail-kicker">V{v.n} n'a pas pu être rendue</div>}
      <div className="fail-head">
        {icon}
        <span className="s">{title}</span>
      </div>
      <div className="fail-text">{text}</div>
      <div className="fail-acts">
        {actions}
        <button className="btn ghost fail-more" onClick={() => setDetail(true)}>
          Voir le détail
        </button>
      </div>
      {detail && <FailureDetail version={v} onClose={() => setDetail(false)} />}
    </div>
  );
}

/** "Voir le détail": the error and the end of the render log, with a copy button. */
function FailureDetail({ version: v, onClose }: { version: Version; onClose: () => void }) {
  const f = failureOf(v);
  const [log, setLog] = useState<string>();
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (isMock) return setLog(f.logTail ?? "");
    let alive = true;
    fetch(scopedPath(`/api/versions/${v.id}/log`))
      .then((r) => (r.ok ? r.text() : (f.logTail ?? "")))
      .catch(() => f.logTail ?? "")
      .then((t) => alive && setLog(t.trimEnd().split("\n").slice(-200).join("\n")));
    return () => {
      alive = false;
    };
  }, [v.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [log]);
  const copy = async () => {
    const text = `Cezane · V${v.n} (${v.id}) · ${failureLabel(v)}\n${f.message}\n\n${log ?? ""}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    toast("Détail copié");
  };
  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg pop fail-dlg" role="dialog" aria-modal="true" aria-label={`Détail de l'échec de V${v.n}`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="t13 s">Échec du rendu · V{v.n}</div>
        <div className="fail-msg">{f.message}</div>
        <div className="c2">Fin du journal de rendu</div>
        <pre ref={pre} className="fail-log scroll">
          {log === undefined ? "Chargement…" : log || "Pas de journal pour ce rendu."}
        </pre>
        <div className="dlg-acts">
          <button className="btn" onClick={() => void copy()}>
            <Copy size={16} />
            Copier
          </button>
          <button className="btn pri" onClick={onClose} autoFocus>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/** A toast when a render of the open reel just failed, with "Voir" (shows that version and its card). */
export function FailureToasts() {
  const { state, ui, setUi } = useApp();
  const seen = useRef(new Map<string, Version["status"]>());
  const loaded = useRef(new Set<string>()); // reels whose versions were seen once (no toast for old failures)
  useEffect(() => {
    if (!state) return;
    const reel = `${state.projectId}/${state.montage.id}`;
    const first = !loaded.current.has(reel);
    loaded.current.add(reel);
    for (const v of state.versions) {
      const key = `${state.projectId}/${v.id}`;
      const before = seen.current.get(key);
      seen.current.set(key, v.status);
      // Failed while we watched it render, or failed at once (a missing file stops it before it shows as rendering).
      if (v.status !== "error" || first || before === "error") continue;
      toast(`V${v.n} : ${failureLabel(v)}`, { label: "Voir", run: () => setUi({ versionId: v.id, view: ui.view === "medias" || ui.view === "canvas" ? "timeline" : ui.view }) });
    }
  }, [state, ui.view, setUi]);
  return null;
}
