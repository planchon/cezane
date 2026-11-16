import { type ClaudeEvent, type Comment, findClip, resolveAnchor } from "@cezane/core";
import { ArrowUp, Check, ChevronDown, ChevronRight, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, assetMedia, assetThumb, fileUrl, post } from "../api";
import { claudeMade, clipIcon, clipLabel } from "../montage/clips";
import { playhead, useApp, useVersionMontage } from "../store";
import { renderVersion } from "../ui/actions";
import { VersionPicker } from "../ui/Pickers";
import { Resizer, usePanelSize } from "../ui/Resizer";
import { clock, pendingForClaude, relTime, shortTool, statusChip, statusLabel, timecode } from "../ui/format";
import { attempt } from "../ui/toast";

export function RightPanel() {
  const { ui, setUi, log } = useApp();
  const waitingPermission = useMemo(() => openPermissions(log).length, [log]);
  const panel = usePanelSize("right", 300, 240, 480);
  return (
    <aside className="R" style={{ width: panel.size }}>
      <Resizer edge="left" panel={panel} />
      <PanelHead />
      <div className="tabs">
        <button className={`tab ${ui.panel === "props" ? "on" : ""}`} onClick={() => setUi({ panel: "props" })}>
          Propriétés
        </button>
        <button className={`tab ${ui.panel === "comments" ? "on" : ""}`} onClick={() => setUi({ panel: "comments" })}>
          Commentaires
        </button>
        <button className={`tab ${ui.panel === "claude" ? "on" : ""}`} onClick={() => setUi({ panel: "claude" })} title={waitingPermission ? "Claude attend une autorisation" : undefined}>
          Claude {waitingPermission > 0 && <span className="alert" />}
        </button>
      </div>
      {ui.panel === "comments" ? <CommentsPanel /> : ui.panel === "claude" ? <ClaudePanel /> : <PropertiesPanel />}
    </aside>
  );
}

/** The displayed version, running jobs, the avatars (you, Claude with its activity), and the primary action. */
function PanelHead() {
  const { state, setUi, connected } = useApp();
  const running = state?.jobs.filter((j) => j.status === "running" || j.status === "queued") ?? [];
  const job = running[0];
  const claude = state?.claude;
  const rendering = state?.versions.some((v) => v.status === "rendering");
  return (
    <div className="rh">
      <VersionPicker empty="Pas de version" />
      <div className="sp" />
      {job && (
        <span className="jobs" title={running.map((j) => `${j.label} ${Math.round(j.progress * 100)} %`).join("\n")}>
          <span className="ring" style={{ "--p": job.progress } as React.CSSProperties} />
          {running.length > 1 && <span>{running.length}</span>}
        </span>
      )}
      <div className="avs">
        <span className="av me" title="Toi">
          P
        </span>
        <button
          className={`av cl ${claude?.running ? "busy" : ""}`}
          style={!connected ? { background: "var(--text-3)" } : undefined}
          onClick={() => setUi({ panel: "claude" })}
          title={!connected ? "Serveur injoignable" : claude?.running ? `Claude travaille · ${claude.task ?? ""}` : "Claude est disponible"}
        >
          C
        </button>
      </div>
      <button className="btn pri" disabled={!state || rendering} onClick={() => void renderVersion()} title="Rendre une nouvelle version du montage">
        {rendering && <Loader2 size={12} className="spin" />}
        Rendre
      </button>
    </div>
  );
}

// ───────────────────────── comments ─────────────────────────

function CommentsPanel() {
  const { state } = useApp();
  const comments = state?.comments ?? [];
  const pending = pendingForClaude(comments);
  const groups: { title: string; items: Comment[]; collapsed?: boolean }[] = [
    { title: "À envoyer à Claude", items: pending },
    { title: "Chez Claude", items: comments.filter((c) => c.status === "sent" || c.status === "in_progress") },
    { title: "Corrigé par Claude", items: comments.filter((c) => c.status === "fixed") },
    { title: "Validés", items: comments.filter((c) => c.status === "validated"), collapsed: true },
  ];
  const n = pending.length;
  return (
    <>
      <div className="rp-body scroll">
        {!comments.length && (
          <div className="empty" style={{ paddingTop: 12 }}>
            Aucun commentaire. Choisis l'outil Commentaire (C) : clic sur l'image pour une épingle, glisser pour une zone, glisser sur la règle pour une plage.
          </div>
        )}
        {groups.map((g) => (g.items.length ? <Group key={g.title} {...g} /> : null))}
      </div>
      <div className="rp-foot">
        <button
          className="btn pri lg block"
          disabled={!n || state?.claude.running}
          onClick={() => attempt(() => post("/api/claude/send", { commentIds: pending.map((c) => c.id) }), "Envoyé à Claude")}
        >
          {state?.claude.running
            ? `Claude travaille… (${n} en attente)`
            : n
              ? `Envoyer ${n} commentaire${n > 1 ? "s" : ""} à Claude`
              : "Envoyer à Claude"}
        </button>
      </div>
    </>
  );
}

function Group({ title, items, collapsed }: { title: string; items: Comment[]; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div>
      <div className={`sh light ${collapsed ? "click" : ""}`} onClick={collapsed ? () => setOpen((o) => !o) : undefined}>
        {title} · {items.length}
        {collapsed && <span className="r">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>}
      </div>
      {open && items.map((c, i) => <CommentItem key={c.id} c={c} first={i === 0} />)}
    </div>
  );
}

function CommentItem({ c, first }: { c: Comment; first: boolean }) {
  const { ui, setUi, state, version } = useApp();
  const montage = useVersionMontage(version, state?.montage);
  const [reply, setReply] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const active = ui.commentId === c.id;
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const fps = version?.fps ?? 30;
  const a = c.anchor;
  let where = "";
  let target: number | undefined;
  let removed = false;
  if (a.kind === "montage") {
    const r = montage ? resolveAnchor(a, montage) : { frame: a.frame, frameEnd: a.frameEnd, status: "same" as const };
    removed = r.status === "removed";
    target = r.frame;
    const v = state?.versions.find((x) => x.id === a.versionId);
    where = `${v ? `V${v.n}` : a.versionId} · ${clock(r.frame, fps)}${r.frameEnd !== undefined ? ` → ${clock(r.frameEnd, fps)}` : ""}${a.region ? " · zone" : a.pin ? " · épingle" : ""}`;
  } else where = "Rushes · élément";
  const fixedIn = c.fixedIn ? state?.versions.find((v) => v.id === c.fixedIn) : undefined;
  const vName = (id?: string) => {
    const v = id ? state?.versions.find((x) => x.id === id) : undefined;
    return v ? `V${v.n}` : id;
  };

  const focus = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, a")) return;
    setUi(a.kind === "canvas" ? { commentId: c.id, view: "medias" } : { commentId: c.id, view: "timeline" });
    if (target !== undefined && !removed) playhead.seek(target);
  };

  const sendReply = () => {
    if (!reply.trim()) return;
    attempt(() => post(`/api/comments/${c.id}/reply`, { text: reply.trim() }));
    setReply("");
  };

  return (
    <div ref={ref} className={`cmt ${active ? "on" : ""} ${first ? "cmt-group-first" : ""}`} onClick={focus} style={first && active ? { paddingTop: 12 } : undefined}>
      {c.thread.map((m, i) => (
        <div key={i} className="msg">
          <span className={`av ${m.author === "user" ? "me" : "cl"}`}>{m.author === "user" ? "P" : "C"}</span>
          <div className="body">
            <div className="who">
              <span className="s">{m.author === "user" ? "Moi" : "Claude"}</span>
              <span className="c2 ell">{i === 0 ? relTime(c.createdAt) : m.versionId ? vName(m.versionId) : relTime(m.at)}</span>
            </div>
            {i === 0 && (
              <div className="c2">
                {where}
                {removed && " · passage supprimé"}
              </div>
            )}
            <div className="txt">{m.text}</div>
          </div>
        </div>
      ))}
      <div className="extra">
        {c.snapshot && (
          <div className="snap">
            <img src={fileUrl(c.snapshot)} alt="Image commentée" onError={(e) => (e.currentTarget.style.display = "none")} />
          </div>
        )}
        <div className="acts">
          <span className={`bd ${statusChip[c.status]}`}>{statusLabel[c.status]}</span>
        </div>
        {(fixedIn || c.status === "fixed" || c.status === "draft") && (
          <div className="acts">
            {fixedIn && a.kind === "montage" && (
              <button
                className="btn"
                onClick={() => {
                  setUi({ versionId: fixedIn.id, compare: true, compareId: a.versionId, commentId: c.id, view: "timeline" });
                  if (target !== undefined) setTimeout(() => playhead.seek(target!), 300);
                }}
              >
                Avant / après
              </button>
            )}
            {c.status === "fixed" && (
              <>
                <button className="btn" onClick={() => attempt(() => post(`/api/comments/${c.id}/status`, { status: "validated" }))}>
                  <Check size={12} /> Valider
                </button>
                <button className="btn" onClick={() => attempt(() => post(`/api/comments/${c.id}/status`, { status: "reopened" }))}>
                  <RotateCcw size={12} /> Rouvrir
                </button>
              </>
            )}
            {c.status === "draft" && (
              <button className="btn ghost" onClick={() => attempt(() => api("DELETE", `/api/comments/${c.id}`))}>
                <Trash2 size={12} /> Supprimer
              </button>
            )}
          </div>
        )}
        {active && c.status !== "validated" && (
          <div className="reply">
            <input
              className="field"
              placeholder="Répondre…"
              title={c.status === "fixed" ? "Répondre rouvre le commentaire" : undefined}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendReply()}
            />
            <button className="send" onClick={sendReply} disabled={!reply.trim()} title="Envoyer">
              <ArrowUp size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Claude ─────────────────────────

function openPermissions(log: ClaudeEvent[]) {
  const done = new Set(log.filter((e) => e.kind === "permission_done").map((e) => e.permissionId));
  return log.filter((e) => e.kind === "permission" && !done.has(e.permissionId));
}

const summarize = (tool: string | undefined, input: unknown): string => {
  const i = (input ?? {}) as Record<string, any>;
  switch (shortTool(tool)) {
    case "edit": {
      const ops: any[] = Array.isArray(i.ops) ? i.ops : [];
      return `${ops.length} opération${ops.length > 1 ? "s" : ""} : ${[...new Set(ops.map((o) => o.op))].join(", ")}`;
    }
    case "look":
      return i.frames ? `frames ${[].concat(i.frames).join(", ")}${i.region ? " · zoom" : ""}` : JSON.stringify(i).slice(0, 80);
    case "comment_context":
      return [].concat(i.ids ?? i.id ?? []).join(", ");
    case "reply":
      return `${i.id ?? i.commentId ?? ""} → ${String(i.text ?? "").slice(0, 70)}`;
    case "generate":
      return `${i.model ?? ""} · ${String(i.prompt ?? "").slice(0, 70)}`;
    case "transcript":
      return i.assetId ?? `${i.start ?? ""}–${i.end ?? ""}`;
    case "import":
      return `${[].concat(i.paths ?? []).length} fichier(s)`;
    case "Bash":
      return String(i.command ?? "");
    default: {
      const s = JSON.stringify(i);
      return s === "{}" ? "" : s.slice(0, 90);
    }
  }
};

export function ClaudePanel() {
  const { log, state } = useApp();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const running = state?.claude.running;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [log.length]);

  // Pair each tool call with its result (next result of the same tool).
  const items = useMemo(() => {
    const used = new Set<string>();
    const done = new Set(log.filter((e) => e.kind === "permission_done").map((e) => e.permissionId));
    return log
      .filter((e) => e.kind !== "tool_result" && e.kind !== "permission_done")
      .map((e) => {
        if (e.kind !== "tool") return { e, done: e.kind === "permission" && done.has(e.permissionId) };
        const idx = log.indexOf(e);
        const res = log.slice(idx + 1).find((r) => r.kind === "tool_result" && r.tool === e.tool && !used.has(r.id));
        if (res) used.add(res.id);
        return { e, res };
      });
  }, [log]);

  const ask = () => {
    if (!text.trim()) return;
    attempt(() => post("/api/claude/ask", { text: text.trim() }));
    setText("");
  };

  return (
    <>
      <div className="sec">
        <div className="sh">
          <span className={`av cl xs ${running ? "busy" : ""}`}>C</span>
          {running ? "Claude travaille" : "Claude attend"}
          <span className="r">
            {state?.claude.model}
            {running && (
              <button className="btn" style={{ marginLeft: 4 }} onClick={() => attempt(() => post("/api/claude/stop"))}>
                Arrêter
              </button>
            )}
          </span>
        </div>
        <div className="pad c2">{state?.claude.task ?? "Commente la vidéo ou écris une consigne."}</div>
      </div>
      <div className="rp-body scroll">
        <div className="feed">
          {!items.length && <div className="c2" style={{ paddingTop: 12 }}>Aucune activité pour l'instant.</div>}
          {items.map(({ e, res, done }) => (
            <Fragment key={e.id}>
              <Event e={e} res={res} done={done} />
            </Fragment>
          ))}
          <div ref={bottom} />
        </div>
      </div>
      <div style={{ padding: 8, borderTop: "1px solid var(--border)" }}>
        <div className="ask">
          <textarea
            rows={2}
            placeholder="Demander une modification à Claude…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
          />
          <button className="send" disabled={!text.trim()} onClick={ask} title="Envoyer à Claude">
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

function Event({ e, res, done }: { e: ClaudeEvent; res?: ClaudeEvent; done?: boolean }) {
  const time = new Date(e.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (e.kind === "start")
    return (
      <div className="ev-sep">
        <span className="s" style={{ color: "var(--text)" }}>{e.text ?? "Nouvelle session"}</span>
        <span>{time}</span>
      </div>
    );
  if (e.kind === "end") return <div className="c2">Terminé{e.costUsd !== undefined ? ` · ${e.costUsd.toFixed(2)} $ (abonnement)` : ""}</div>;
  if (e.kind === "error") return <div className="ev-err">{e.text}</div>;
  if (e.kind === "text") return <div className="ev-text">{e.text}</div>;
  if (e.kind === "permission")
    return (
      <div className="ev-perm">
        <div className="s">Autorisation demandée · {shortTool(e.tool)}</div>
        {e.text && <div>{e.text}</div>}
        <pre>{summarize(e.tool, e.input) || JSON.stringify(e.input, null, 1)}</pre>
        {done ? (
          <span className="c2">Répondu</span>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn pri" onClick={() => attempt(() => post(`/api/claude/permission/${e.permissionId}`, { allow: true }))}>
              Autoriser
            </button>
            <button className="btn" onClick={() => attempt(() => post(`/api/claude/permission/${e.permissionId}`, { allow: false, message: "Refusé par l'utilisateur" }))}>
              Refuser
            </button>
          </div>
        )}
      </div>
    );
  return (
    <div className="ev-tool" title={res?.text ?? JSON.stringify(e.input, null, 1)}>
      <span className={`dot ${!res ? "wait" : res.ok === false ? "no" : ""}`} />
      <span className="name">{shortTool(e.tool)}</span>
      <span className="sum">{res?.ok === false && res.text ? res.text : summarize(e.tool, e.input)}</span>
    </div>
  );
}

// ───────────────────────── properties ─────────────────────────

function PropertiesPanel() {
  const { ui, state, version } = useApp();
  const montage = useVersionMontage(version, state?.montage);
  const sel = ui.selection;
  if (!sel || !state)
    return (
      <div className="empty" style={{ paddingTop: 12 }}>
        Sélectionne un plan, un clip de la timeline ou un rush.
      </div>
    );
  const fps = montage?.settings.fps ?? 30;

  if (sel.kind === "asset") {
    const a = state.project.assets.find((x) => x.id === sel.id);
    if (!a) return <div className="empty" style={{ paddingTop: 12 }}>Rush introuvable.</div>;
    const thumb = assetThumb(a);
    const p = a.provenance;
    const sub = [a.kind === "video" ? "vidéo" : a.kind === "audio" ? "son" : "image", a.width && `${a.width}×${a.height}`, a.fps && `${a.fps} i/s`, a.duration !== undefined && `${a.duration.toFixed(1)} s`]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="rp-body scroll">
        <div className="sec">
          <div className="sh">
            <span className="ell" style={claudeMade(a) ? { color: "var(--c-600)" } : undefined}>
              {a.name}
            </span>
          </div>
          <div className="pad c2" style={{ marginTop: -8 }}>
            {sub}
          </div>
          {(a.kind === "audio" || (a.kind === "video" && a.status === "ready") || thumb) && (
            <div className="pad" style={{ marginTop: 12 }}>
              {a.kind === "video" && a.status === "ready" ? (
                <video className="preview" src={assetMedia(a)} poster={thumb} controls muted />
              ) : a.kind === "audio" ? (
                <audio src={assetMedia(a)} controls style={{ width: "100%" }} />
              ) : (
                <img className="preview" src={thumb} alt="" />
              )}
            </div>
          )}
        </div>
        <div className="sec last">
          <div className="sh">Infos</div>
          <dl className="kv pad" style={{ margin: 0 }}>
            <dt>État</dt>
            <dd>{a.status === "error" ? <span style={{ color: "var(--red-600)" }}>{a.error}</span> : a.status === "ingesting" ? "import en cours" : "prêt"}</dd>
            <dt>Provenance</dt>
            <dd>{p.type === "import" ? `import · ${p.path}` : p.type === "capture" ? `capture ${p.source} · ${p.target}` : `${p.provider} · ${p.model}`}</dd>
            {p.type === "generated" && (
              <>
                <dt>Prompt</dt>
                <dd>{p.prompt}</dd>
                {p.cost !== undefined && (
                  <>
                    <dt>Coût</dt>
                    <dd>{p.cost.toFixed(2)} €</dd>
                  </>
                )}
              </>
            )}
            <dt>Dérivés</dt>
            <dd>{Object.keys(a.derived).join(", ") || "—"}</dd>
            <dt>Id</dt>
            <dd>{a.id}</dd>
          </dl>
        </div>
      </div>
    );
  }

  const hit = montage ? findClip(montage, sel.id) : undefined;
  if (!hit) return <div className="empty" style={{ paddingTop: 12 }}>Clip introuvable dans cette version.</div>;
  const c = hit.clip;
  const asset = c.type === "media" ? state.project.assets.find((a) => a.id === c.assetId) : undefined;
  const Icon = clipIcon(c, hit.track, asset);
  const tone = c.type === "graphic" ? "var(--p-600)" : claudeMade(asset) ? "var(--c-600)" : undefined;
  const { id: _id, type: _t, start: _s, duration: _d, ...rest } = c as Record<string, unknown>;
  return (
    <div className="rp-body scroll">
      <div className="sec">
        <div className="sh">
          <Icon size={16} style={tone ? { color: tone } : undefined} />
          <span className="ell" style={tone ? { color: tone } : undefined}>
            {clipLabel(c, asset)}
          </span>
        </div>
        <div className="pad c2" style={{ marginTop: -8 }}>
          Piste {hit.track.name} · {c.id}
        </div>
      </div>
      <div className="sec">
        <div className="sh">
          Temps
          <span className="r">
            <button className="btn ghost" onClick={() => playhead.seek(c.start)}>
              Aller au début
            </button>
          </span>
        </div>
        <dl className="kv pad" style={{ margin: 0 }}>
          <dt>Début</dt>
          <dd title={`frame ${c.start}`}>{timecode(c.start, fps)}</dd>
          <dt>Fin</dt>
          <dd title={`frame ${c.start + c.duration}`}>{timecode(c.start + c.duration, fps)}</dd>
          <dt>Durée</dt>
          <dd>{(c.duration / fps).toFixed(2)} s</dd>
          {c.type === "media" && (
            <>
              <dt>Source</dt>
              <dd>
                {asset?.name ?? c.assetId} à {c.srcIn.toFixed(2)} s
              </dd>
            </>
          )}
          {c.type === "captions" && (
            <>
              <dt>Mots</dt>
              <dd>{c.words.length}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="sec last">
        <div className="sh">Réglages</div>
        <div className="pad">
          <pre className="code">{JSON.stringify(c.type === "captions" ? { ...rest, words: `${c.words.length} mots` } : rest, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
