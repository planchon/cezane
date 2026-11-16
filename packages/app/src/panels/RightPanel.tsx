import { type ClaudeEvent, type Comment, findClip, resolveAnchor } from "@cezane/core";
import { Bot, Check, ChevronDown, ChevronRight, CircleStop, MessageSquare, RotateCcw, Send, SlidersHorizontal, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, assetMedia, assetThumb, fileUrl, post } from "../api";
import { playhead, useApp, useVersionMontage } from "../store";
import { pendingForClaude, relTime, shortTool, statusChip, statusLabel, timecode } from "../ui/format";
import { attempt } from "../ui/toast";

export function RightPanel() {
  const { ui, setUi, state, log } = useApp();
  const pending = pendingForClaude(state?.comments ?? []).length;
  const waitingPermission = useMemo(() => openPermissions(log).length, [log]);
  return (
    <aside className="panel rp">
      <div className="rp-tabs">
        <button className={ui.panel === "comments" ? "on" : ""} onClick={() => setUi({ panel: "comments" })}>
          <MessageSquare size={14} /> Commentaires {pending > 0 && <span className="count">{pending}</span>}
        </button>
        <button className={ui.panel === "claude" ? "on" : ""} onClick={() => setUi({ panel: "claude" })}>
          <Bot size={14} /> Claude {waitingPermission > 0 && <span className="count" style={{ background: "var(--ochre)" }}>!</span>}
        </button>
        <button className={ui.panel === "props" ? "on" : ""} onClick={() => setUi({ panel: "props" })}>
          <SlidersHorizontal size={14} /> Propriétés
        </button>
      </div>
      {ui.panel === "comments" ? <CommentsPanel /> : ui.panel === "claude" ? <ClaudePanel /> : <PropertiesPanel />}
    </aside>
  );
}

// ───────────────────────── comments ─────────────────────────

function CommentsPanel() {
  const { state } = useApp();
  const comments = state?.comments ?? [];
  const pending = pendingForClaude(comments);
  const groups: { title: string; items: Comment[]; collapsed?: boolean }[] = [
    { title: "À envoyer", items: pending },
    { title: "Chez Claude", items: comments.filter((c) => c.status === "sent" || c.status === "in_progress") },
    { title: "Corrigés — à valider", items: comments.filter((c) => c.status === "fixed") },
    { title: "Validés", items: comments.filter((c) => c.status === "validated"), collapsed: true },
  ];
  return (
    <>
      <div className="rp-body scroll">
        {!comments.length && (
          <div className="empty">
            Aucun commentaire.
            <br />
            Choisis l'outil Commentaire (C) : clic sur l'image pour une épingle, glisser pour une zone, glisser sur la règle pour une plage.
          </div>
        )}
        {groups.map((g) => (g.items.length ? <Group key={g.title} {...g} /> : null))}
      </div>
      <div className="rp-foot">
        <button
          className="btn big accent"
          disabled={!pending.length || state?.claude.running}
          onClick={() => attempt(() => post("/api/claude/send", { commentIds: pending.map((c) => c.id) }), "Envoyé à Claude")}
        >
          <Send size={15} /> {state?.claude.running ? `Claude travaille… (${pending.length} en attente)` : `Envoyer à Claude (${pending.length})`}
        </button>
      </div>
    </>
  );
}

function Group({ title, items, collapsed }: { title: string; items: Comment[]; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="group">
      <div className="group-title" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title} <span className="chip">{items.length}</span>
      </div>
      {open && items.map((c) => <CommentCard key={c.id} c={c} />)}
    </div>
  );
}

function CommentCard({ c }: { c: Comment }) {
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
    where = `${v ? `V${v.n}` : a.versionId} · ${timecode(r.frame, fps)}${r.frameEnd !== undefined ? ` → ${timecode(r.frameEnd, fps)}` : ""}${a.region ? " · zone" : a.pin ? " · épingle" : ""}`;
  } else where = "Canvas · élément";
  const fixedIn = c.fixedIn ? state?.versions.find((v) => v.id === c.fixedIn) : undefined;

  const focus = () => {
    setUi(a.kind === "canvas" ? { commentId: c.id, tab: "canvas" } : { commentId: c.id, tab: "montage" });
    if (target !== undefined && !removed) playhead.seek(target);
  };

  const sendReply = () => {
    if (!reply.trim()) return;
    attempt(() => post(`/api/comments/${c.id}/reply`, { text: reply.trim() }));
    setReply("");
  };

  return (
    <div ref={ref} className={`ccard ${active ? "on" : ""}`}>
      <div className="ccard-head" onClick={focus}>
        <span className={`cnum ${c.status}`}>{c.n}</span>
        <span className={`chip ${statusChip[c.status]}`}>{statusLabel[c.status]}</span>
        <span className="where" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {where}
          {removed && " · passage supprimé"}
        </span>
        <span className="muted" style={{ fontSize: 10.5 }}>{relTime(c.createdAt)}</span>
      </div>
      <div className="msgs">
        {c.thread.map((m, i) => (
          <div key={i} className="msg">
            <span className={`av ${m.author}`}>{m.author === "user" ? "P" : "C"}</span>
            <div>
              {m.text}
              {m.versionId && <small>{state?.versions.find((v) => v.id === m.versionId) ? `V${state.versions.find((v) => v.id === m.versionId)!.n}` : m.versionId}</small>}
            </div>
          </div>
        ))}
      </div>
      {(c.snapshot || fixedIn) && (
        <div className="snap">
          {c.snapshot && (
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Avant</div>
              <img src={fileUrl(c.snapshot)} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
            </div>
          )}
          {fixedIn && a.kind === "montage" && (
            <button
              className="btn sm"
              onClick={() => {
                setUi({ versionId: fixedIn.id, compare: true, compareId: a.versionId, commentId: c.id, tab: "montage" });
                if (target !== undefined) setTimeout(() => playhead.seek(target!), 300);
              }}
            >
              Avant / après · V{fixedIn.n}
            </button>
          )}
        </div>
      )}
      {(c.status === "fixed" || c.status === "draft") && (
        <div className="ccard-actions">
          {c.status === "fixed" && (
            <>
              <button className="btn sm" style={{ borderColor: "var(--sage)", color: "#435a3d" }} onClick={() => attempt(() => post(`/api/comments/${c.id}/status`, { status: "validated" }))}>
                <Check size={13} /> Valider
              </button>
              <button className="btn sm" onClick={() => attempt(() => post(`/api/comments/${c.id}/status`, { status: "reopened" }))}>
                <RotateCcw size={13} /> Rouvrir
              </button>
            </>
          )}
          {c.status === "draft" && (
            <button className="btn sm ghost" onClick={() => attempt(() => api("DELETE", `/api/comments/${c.id}`))}>
              <Trash2 size={13} /> Supprimer
            </button>
          )}
        </div>
      )}
      {active && c.status !== "validated" && (
        <div className="reply">
          <input
            className="field"
            placeholder={c.status === "fixed" ? "Répondre (rouvre le commentaire)…" : "Répondre…"}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendReply()}
          />
          <button className="icon-btn" onClick={sendReply} disabled={!reply.trim()}>
            <Send size={15} />
          </button>
        </div>
      )}
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

function ClaudePanel() {
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        <span className={`claude-dot ${running ? "on" : ""}`} style={{ padding: 0, height: "auto" }}>
          <i />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 12.5 }}>{running ? "Claude travaille" : "Claude attend"}</div>
          <div className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state?.claude.task ?? "Commente la vidéo ou écris une consigne."}</div>
        </div>
        <span className="chip terracotta">{state?.claude.model}</span>
        {running && (
          <button className="btn sm" onClick={() => attempt(() => post("/api/claude/stop"))}>
            <CircleStop size={13} /> Stop
          </button>
        )}
      </div>
      <div className="rp-body scroll">
        <div className="feed">
          {!items.length && <div className="empty">Aucune activité pour l'instant.</div>}
          {items.map(({ e, res, done }) => (
            <Fragment key={e.id}>
              <Event e={e} res={res} done={done} />
            </Fragment>
          ))}
          <div ref={bottom} />
        </div>
      </div>
      <div className="rp-foot">
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea
            className="field"
            rows={2}
            placeholder="Une consigne pour Claude (ex. « coupe les silences et ajoute des sous-titres »)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
          />
          <button className="btn primary" style={{ height: 38 }} disabled={!text.trim()} onClick={ask}>
            <Send size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

function Event({ e, res, done }: { e: ClaudeEvent; res?: ClaudeEvent; done?: boolean }) {
  const time = new Date(e.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (e.kind === "start") return <div className="ev sep">{time} · {e.text ?? "Nouvelle session"}</div>;
  if (e.kind === "end") return <div className="ev sep">Terminé{e.costUsd !== undefined ? ` · ${e.costUsd.toFixed(2)} $ (abonnement)` : ""}</div>;
  if (e.kind === "error") return <div className="ev err">⚠ {e.text}</div>;
  if (e.kind === "text") return <div className="ev text">{e.text}</div>;
  if (e.kind === "permission")
    return (
      <div className="ev perm">
        <div style={{ fontWeight: 650 }}>Autorisation demandée · {shortTool(e.tool)}</div>
        {e.text && <div style={{ marginTop: 4 }}>{e.text}</div>}
        <pre>{summarize(e.tool, e.input) || JSON.stringify(e.input, null, 1)}</pre>
        {done ? (
          <span className="chip">répondu</span>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn sm primary" onClick={() => attempt(() => post(`/api/claude/permission/${e.permissionId}`, { allow: true }))}>
              Autoriser
            </button>
            <button className="btn sm" onClick={() => attempt(() => post(`/api/claude/permission/${e.permissionId}`, { allow: false, message: "Refusé par l'utilisateur" }))}>
              Refuser
            </button>
          </div>
        )}
      </div>
    );
  return (
    <div className="ev tool" title={res?.text ?? JSON.stringify(e.input, null, 1)}>
      <span className={`ok-dot ${!res ? "wait" : res.ok === false ? "no" : ""}`} />
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
  if (!sel || !state) return <div className="empty">Sélectionne un clip dans la timeline ou un asset.</div>;
  const fps = montage?.settings.fps ?? 30;

  if (sel.kind === "asset") {
    const a = state.project.assets.find((x) => x.id === sel.id);
    if (!a) return <div className="empty">Asset introuvable.</div>;
    const thumb = assetThumb(a);
    const p = a.provenance;
    return (
      <div className="rp-body scroll">
        <div className="props">
          {a.kind === "video" && a.status === "ready" ? (
            <video src={assetMedia(a)} poster={thumb} controls muted style={{ width: "100%", borderRadius: 10, marginBottom: 10, maxHeight: 260, background: "#191419" }} />
          ) : a.kind === "audio" ? (
            <audio src={assetMedia(a)} controls style={{ width: "100%", marginBottom: 10 }} />
          ) : thumb ? (
            <img src={thumb} alt="" style={{ width: "100%", borderRadius: 10, marginBottom: 10, maxHeight: 260, objectFit: "contain", background: "var(--paper-2)" }} />
          ) : null}
          <h4>{a.name}</h4>
          <dl className="kv">
            <dt>Id</dt>
            <dd className="mono">{a.id}</dd>
            <dt>Type</dt>
            <dd>{a.kind}</dd>
            {a.duration !== undefined && (
              <>
                <dt>Durée</dt>
                <dd>{a.duration.toFixed(2)} s</dd>
              </>
            )}
            {a.width && (
              <>
                <dt>Taille</dt>
                <dd>
                  {a.width}×{a.height}
                  {a.fps ? ` · ${a.fps} i/s` : ""}
                </dd>
              </>
            )}
            <dt>État</dt>
            <dd>{a.status === "error" ? <span style={{ color: "var(--apple)" }}>{a.error}</span> : a.status}</dd>
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
          </dl>
        </div>
      </div>
    );
  }

  const hit = montage ? findClip(montage, sel.id) : undefined;
  if (!hit) return <div className="empty">Clip introuvable dans cette version.</div>;
  const c = hit.clip;
  const asset = c.type === "media" ? state.project.assets.find((a) => a.id === c.assetId) : undefined;
  const { id: _id, type: _t, start: _s, duration: _d, ...rest } = c as Record<string, unknown>;
  return (
    <div className="rp-body scroll">
      <div className="props">
        <h4>{c.type === "graphic" ? c.component : c.type === "captions" ? "Sous-titres" : (asset?.name ?? "Média")}</h4>
        <dl className="kv">
          <dt>Id</dt>
          <dd className="mono">{c.id}</dd>
          <dt>Piste</dt>
          <dd>{hit.track.name}</dd>
          <dt>Début</dt>
          <dd>
            {timecode(c.start, fps)} <span className="muted">· f{c.start}</span>
          </dd>
          <dt>Fin</dt>
          <dd>
            {timecode(c.start + c.duration, fps)} <span className="muted">· f{c.start + c.duration}</span>
          </dd>
          <dt>Durée</dt>
          <dd>{(c.duration / fps).toFixed(2)} s</dd>
          {c.type === "media" && (
            <>
              <dt>Source</dt>
              <dd>
                {asset?.name ?? c.assetId} @ {c.srcIn.toFixed(2)} s
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
        <pre>{JSON.stringify(c.type === "captions" ? { ...rest, words: `${c.words.length} mots` } : rest, null, 2)}</pre>
        <button className="btn sm" onClick={() => playhead.seek(c.start)}>Aller au début du clip</button>
      </div>
    </div>
  );
}
