import { type Comment, type Montage, resolveAnchor, type Track, type Version } from "@cezane/core";
import { AudioLines, Captions, Clapperboard, Layers, Minus, Plus, Shapes, ZoomIn } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assetThumb } from "../api";
import { playhead, useApp, useFrame } from "../store";
import { seconds, timecode } from "../ui/format";

const NAME_W = 118;
const RULER_H = 26;

const trackIcon = (t: Track) =>
  t.kind === "audio" ? AudioLines : t.role === "captions" ? Captions : t.role === "graphics" ? Shapes : t.role === "main" ? Clapperboard : Layers;

type Props = {
  montage?: Montage;
  version?: Version;
  onRangeComment: (start: number, end: number) => void;
};

export function Timeline({ montage, version, onRangeComment }: Props) {
  const { state, ui, setUi } = useApp();
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<{ a: number; b: number }>();
  const fps = version?.fps ?? montage?.settings.fps ?? 30;
  const duration = Math.max(1, version?.durationFrames ?? montageEnd(montage) ?? 1);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ppf = (Math.max(200, width - NAME_W - 24) / duration) * zoom; // pixels per frame
  const contentW = duration * ppf;
  const x = (f: number) => NAME_W + f * ppf;
  const assets = useMemo(() => new Map(state?.project.assets.map((a) => [a.id, a])), [state?.project.assets]);

  const ticks = useMemo(() => {
    const pxPerSec = ppf * fps;
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pxPerSec >= 70) ?? 300;
    const minor = step / 5;
    const out: { f: number; major: boolean }[] = [];
    for (let s = 0; s * fps <= duration; s += minor) out.push({ f: Math.round(s * fps), major: Math.abs(s / step - Math.round(s / step)) < 1e-6 });
    return out;
  }, [ppf, fps, duration]);

  const frameAt = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(duration - 1, Math.floor((clientX - r.left + el.scrollLeft - NAME_W) / ppf)));
  };

  // Ruler: scrub (select tool) or draw a time range (comment tool).
  const onRulerDown = (e: React.PointerEvent) => {
    const start = frameAt(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (ui.tool === "comment") {
      setDraft({ a: start, b: start });
      const move = (ev: PointerEvent) => setDraft({ a: start, b: frameAt(ev.clientX) });
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const end = frameAt(ev.clientX);
        setDraft(undefined);
        const [a, b] = [Math.min(start, end), Math.max(start, end)];
        onRangeComment(a, b - a < 3 ? a : b);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    } else {
      playhead.seek(start);
      const move = (ev: PointerEvent) => playhead.seek(frameAt(ev.clientX));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
  };

  const comments = (state?.comments ?? []).filter((c) => c.anchor.kind === "montage");
  const tracks = [...(montage?.tracks ?? [])].reverse();

  return (
    <div className="panel timeline">
      <div className="tl-head">
        <Transport fps={fps} duration={duration} />
        <div className="spacer" />
        {version?.changed.length ? (
          <span className="chip ochre" title="Passages re-rendus depuis la version précédente">
            {version.changed.length} passage{version.changed.length > 1 ? "s" : ""} modifié{version.changed.length > 1 ? "s" : ""}
          </span>
        ) : null}
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} title="Dézoomer">
          <Minus size={15} />
        </button>
        <span className="muted" style={{ fontSize: 11, minWidth: 34, textAlign: "center" }}>
          <ZoomIn size={12} style={{ verticalAlign: -2 }} /> {zoom.toFixed(1)}×
        </span>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(40, z * 1.5))} title="Zoomer">
          <Plus size={15} />
        </button>
      </div>
      <div
        className="tl-scroll scroll"
        ref={scroller}
        style={{ flex: 1 }}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setZoom((z) => Math.min(40, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
        }}
      >
        <div className="tl-inner" style={{ width: NAME_W + contentW + 24 }}>
          {/* ruler */}
          <div style={{ position: "sticky", top: 0, zIndex: 9, display: "flex", height: RULER_H }}>
            <div style={{ position: "sticky", left: 0, width: NAME_W, flex: "none", background: "var(--paper-2)", borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)", zIndex: 2 }} />
            <div className={`ruler ${ui.tool === "comment" ? "comment" : ""}`} style={{ width: contentW + 24, position: "relative" }} onPointerDown={onRulerDown}>
              {ticks.map((t) => (
                <div key={t.f}>
                  <div className={`tick ${t.major ? "major" : ""}`} style={{ left: t.f * ppf }} />
                  {t.major && <div className="tick-label" style={{ left: t.f * ppf }}>{seconds(t.f, fps).replace(".0 s", " s")}</div>}
                </div>
              ))}
              {version?.changed.map((r, i) => <div key={i} className="changed-bar" style={{ left: r.start * ppf, width: Math.max(2, (r.end - r.start) * ppf) }} />)}
              {comments.map((c) => (
                <CommentMark key={c.id} c={c} montage={montage} ppf={ppf} active={ui.commentId === c.id} onClick={() => {
                  setUi({ commentId: c.id, panel: "comments" });
                }} />
              ))}
              {draft && <div className="range-draft" style={{ left: Math.min(draft.a, draft.b) * ppf, width: Math.max(2, Math.abs(draft.b - draft.a) * ppf) }} />}
            </div>
          </div>
          {/* lanes */}
          {tracks.map((t) => {
            const Icon = trackIcon(t);
            return (
              <div key={t.id} style={{ display: "flex", height: 30, borderBottom: "1px solid rgba(230,220,203,.55)" }}>
                <div className="tl-name" style={{ position: "sticky", left: 0, zIndex: 5, width: NAME_W, flex: "none", background: "var(--paper-2)", borderRight: "1px solid var(--line)", opacity: t.hidden ? 0.5 : 1 }}>
                  <Icon size={13} />
                  {t.name}
                </div>
                <div className="lane" style={{ width: contentW + 24 }} onPointerDown={(e) => e.target === e.currentTarget && ui.tool !== "comment" && playhead.seek(frameAt(e.clientX))}>
                  {t.clips.map((c) => {
                    const sel = ui.selection?.kind === "clip" && ui.selection.id === c.id;
                    const asset = c.type === "media" ? assets.get(c.assetId) : undefined;
                    const kind = t.kind === "audio" ? "audio" : c.type;
                    const label =
                      c.type === "media"
                        ? (asset?.name ?? c.assetId)
                        : c.type === "graphic"
                          ? `${c.component}${typeof c.props.text === "string" ? ` · ${c.props.text}` : typeof c.props.name === "string" ? ` · ${c.props.name}` : ""}`
                          : `Sous-titres · ${c.words.slice(0, 6).map((w) => w.text).join(" ")}`;
                    const thumb = asset && t.kind !== "audio" ? assetThumb(asset) : undefined;
                    return (
                      <div
                        key={c.id}
                        className={`clip ${kind} ${sel ? "sel" : ""}`}
                        style={{ left: c.start * ppf, width: Math.max(3, c.duration * ppf - 2) }}
                        title={`${label}\n${timecode(c.start, fps)} → ${timecode(c.start + c.duration, fps)}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setUi({ selection: { kind: "clip", id: c.id }, panel: "props" })}
                      >
                        {thumb && <div className="thumbs" style={{ backgroundImage: `url("${thumb}")` }} />}
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!tracks.length && <div className="empty">Le montage est vide.</div>}
          {/* passages changed since the previous version */}
          {version?.changed.map((r, i) => <div key={i} className="changed" style={{ left: x(r.start), width: Math.max(2, (r.end - r.start) * ppf) }} />)}
          <Playhead x={x} scroller={scroller} />
        </div>
      </div>
    </div>
  );
}

function montageEnd(m?: Montage) {
  if (!m) return undefined;
  let e = 0;
  for (const t of m.tracks) for (const c of t.clips) e = Math.max(e, c.start + c.duration);
  return e || undefined;
}

function CommentMark({ c, montage, ppf, active, onClick }: { c: Comment; montage?: Montage; ppf: number; active: boolean; onClick: () => void }) {
  if (c.anchor.kind !== "montage") return null;
  const r = montage ? resolveAnchor(c.anchor, montage) : { frame: c.anchor.frame, frameEnd: c.anchor.frameEnd, status: "same" as const };
  if (r.status === "removed") return null;
  const cls = c.status === "in_progress" ? "sent" : c.status;
  const isRange = r.frameEnd !== undefined && r.frameEnd > r.frame;
  return (
    <div
      className={`cmark ${cls} ${isRange ? "range" : ""}`}
      style={{ left: r.frame * ppf, width: isRange ? Math.max(18, (r.frameEnd! - r.frame) * ppf) : undefined, outline: active ? "2px solid var(--ink)" : undefined }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        playhead.seek(r.frame);
        onClick();
      }}
      title={c.thread[0]?.text}
    >
      {c.n}
    </div>
  );
}

function Playhead({ x, scroller }: { x: (f: number) => number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const frame = useFrame();
  const left = x(frame);
  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playhead.isPlaying()) return;
    if (left > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = left - NAME_W - 40;
  }, [left, scroller]);
  return <div className="playhead" style={{ left }} />;
}

function Transport({ fps, duration }: { fps: number; duration: number }) {
  const frame = useFrame();
  return (
    <div className="tc">
      <b>{timecode(frame, fps)}</b> / {timecode(duration, fps)} <span className="muted">· frame {frame}</span>
    </div>
  );
}
