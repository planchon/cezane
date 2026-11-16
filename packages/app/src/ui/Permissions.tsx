import { LEVEL_PRESETS, PERMISSION_LEVELS, type PermissionCategory, type PermissionLevel, type PermissionsPatch, type PermissionsView } from "@cezane/core";
import { Lock, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, get } from "../api";
import { toast } from "./toast";

/** "Autorisations de Claude": what Claude may do without asking, for every project (~/Cezane/settings.json). */

let show: (() => void) | undefined;

/** Opens the dialog (from the Claude tab header). */
export function openPermissions() {
  show?.();
}

const LEVELS: Record<PermissionLevel, { label: string; line: string }> = {
  prudent: { label: "Prudent", line: "Seulement les outils Cezane. Tout le reste demande." },
  equilibre: { label: "Équilibré", line: "Le projet et ~/Cezane, commandes sans risque, web. Le reste demande." },
  autonome: { label: "Autonome", line: "Tout, partout, sans demander. Sauf les dépenses." },
};

const CATEGORIES: { id: PermissionCategory; label: string; sub: (v: PermissionsView, where: string) => string }[] = [
  { id: "read", label: "Lecture des fichiers", sub: (_v, where) => where },
  { id: "edit", label: "Modification des fichiers", sub: (v, where) => (v.level === "autonome" ? where : `${where}, sauf les fichiers internes de Cezane`) },
  { id: "safeCommands", label: "Commandes sans risque", sub: (v) => v.safeCommands.join(", ") },
  { id: "web", label: "Web", sub: () => "Lire des pages, chercher" },
  { id: "otherCommands", label: "Autres commandes", sub: () => "Toute autre commande du terminal" },
];

/** /Users/paul/Cezane → ~/Cezane */
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

export function PermissionsHost() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PermissionsView>();
  useEffect(() => {
    show = () => {
      setOpen(true);
      get<PermissionsView>("/api/settings/permissions").then(setView, (e: Error) => toast(`Autorisations illisibles : ${e.message}`));
    };
    return () => {
      show = undefined;
    };
  }, []);
  if (!open) return null;
  const close = () => setOpen(false);
  const save = (fn: () => Promise<PermissionsView>) => fn().then(setView, (e: Error) => toast(e.message));
  const patch = (p: PermissionsPatch) => save(() => api<PermissionsView>("PUT", "/api/settings/permissions", p));
  const remove = (rule: string) => save(() => api<PermissionsView>("DELETE", "/api/settings/permissions/rules", { rule }));
  const where = view?.level === "autonome" ? "Partout sur le Mac" : `Projet et ${tilde(view?.home ?? "~/Cezane")}`;

  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dlg pop pm" role="dialog" aria-modal="true" aria-label="Autorisations de Claude" onKeyDown={(e) => e.key === "Escape" && close()} tabIndex={-1}>
        <div className="pm-head">
          <div className="t13 s">Autorisations de Claude</div>
          <button className="ib" onClick={close} aria-label="Fermer" autoFocus>
            <X size={16} />
          </button>
        </div>
        <p className="c2 pm-intro">Ce que Claude fait sans te demander, dans tous les projets.</p>
        {!view ? (
          <div className="c2 pm-load">Chargement…</div>
        ) : (
          <>
            <div className="pm-level">
              <div className="seg" role="radiogroup" aria-label="Niveau">
                {PERMISSION_LEVELS.map((l) => (
                  <button key={l} role="radio" aria-checked={view.level === l} className={view.level === l ? "on" : ""} title={LEVELS[l].line} onClick={() => view.level !== l && patch({ level: l })}>
                    {LEVELS[l].label}
                  </button>
                ))}
              </div>
              <div className="c2">{LEVELS[view.level].line}</div>
            </div>

            <div className="pm-sec">
              <div className="pm-sh">
                <span>Sans demander</span>
                {view.custom && (
                  <button className="pm-link" onClick={() => patch({ categories: LEVEL_PRESETS[view.level] })} title={`Revenir aux réglages du niveau ${LEVELS[view.level].label}`}>
                    Modifié · Rétablir
                  </button>
                )}
              </div>
              {CATEGORIES.map((c) => {
                const on = view.categories[c.id];
                return (
                  <label key={c.id} className="pm-row">
                    <span className="pm-txt">
                      <span>{c.label}</span>
                      <span className="c2 ell" title={c.sub(view, where)}>
                        {c.sub(view, where)}
                      </span>
                    </span>
                    <button role="switch" aria-checked={on} className={`sw ${on ? "on" : ""}`} onClick={() => patch({ categories: { [c.id]: !on } })}>
                      <span />
                    </button>
                  </label>
                );
              })}
            </div>

            <div className="pm-sec">
              <div className="pm-sh">
                <span>Règles ajoutées{view.rules.length ? ` · ${view.rules.length}` : ""}</span>
              </div>
              {!view.rules.length ? (
                <div className="c2 pm-empty">« Toujours autoriser » sur une demande de Claude ajoute une règle ici.</div>
              ) : (
                <div className="pm-rules scroll">
                  {view.rules.map((r) => (
                    <div key={r.rule} className="pm-rule">
                      <span className="pm-txt">
                        <code className="ell" title={r.rule}>
                          {r.rule}
                        </code>
                        <span className="c2 ell" title={r.example}>
                          {r.example ? `${r.example} · ` : ""}
                          {day(r.addedAt)}
                        </span>
                      </span>
                      <button className="ib" onClick={() => void remove(r.rule)} title="Retirer la règle" aria-label={`Retirer ${r.rule}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pm-paid">
              <Lock size={14} />
              <span>Les générations payantes demandent toujours, à chaque niveau.</span>
            </div>
            <div className="c2 pm-foot">
              <div className="ell" title={view.file}>
                Pour tous les projets · {tilde(view.file)}
              </div>
              <div>Un réglage plus strict vaut dès la prochaine session de Claude.</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
