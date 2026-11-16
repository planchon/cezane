import { type Comment, type Montage, resolveAnchor, type Version } from "@cezane/core";
import { Minus, Pause, Play, Plus, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assetThumb } from "../api";
import { playhead, useApp, useFrame, usePlaying } from "../store";
import { clock, clockShort, timecode } from "../ui/format";
import { claudeMade, clipIcon, clipLabel, commentAvatar, trackIcon } from "./clips";

const NAME_W = 120; // track names column
const GUTTER = 12; // space between the names column and frame 0
const MAX_ZOOM = 40;

type Props = {
  montage?: Montage;
  version?: Version;
  onRangeComment: (start: number, end: number) => void;
};

/** Docked timeline under the canvas: transport and zoom on top, then the ruler and one lane per track. */
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

  const ppf = (Math.max(200, width - NAME_W - GUTTER - 16) / duration) * zoom; // pixels per frame
  const contentW = duration * ppf + GUTTER + 16;
  const x = (f: number) => NAME_W + GUTTER + f * ppf;
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
    return Math.max(0, Math.min(duration - 1, Math.floor((clientX - r.left + el.scrollLeft - NAME_W - GUTTER) / ppf)));
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
  // Layers as in Figma: the top-most video layer first, then the audio tracks.
  const all = montage?.tracks ?? [];
  const tracks = [...all.filter((t) => t.kind !== "audio").reverse(), ...all.filter((t) => t.kind === "audio")];
  const markFrames = comments.flatMap((c) => {
    if (c.anchor.kind !== "montage") return [];
    const r = montage ? resolveAnchor(c.anchor, montage) : { frame: c.anchor.frame, status: "same" };
    return r.status === "removed" ? [] : [r.frame];
  });
  const changed = version?.changed.length ?? 0;
  const at = (f: number) => GUTTER + f * ppf; // position inside the ruler / a lane

  return (
    <div className="tl">
      <div className="tlh">
        <Transport fps={fps} duration={duration} />
        <div className="sp" />
        {changed > 0 && (
          <span className="bd c" style={{ marginRight: 8 }} title="Passages re-rendus depuis la version précédente">
            {changed} passage{changed > 1 ? "s" : ""} modifié{changed > 1 ? "s" : ""}
          </span>
        )}
        <button className="ib" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} title="Dézoomer">
          <Minus size={16} />
        </button>
        <input
          className="zoom"
          type="range"
          min={0}
          max={Math.log(MAX_ZOOM)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
          style={{ "--fill": `${(Math.log(zoom) / Math.log(MAX_ZOOM)) * 100}%` } as React.CSSProperties}
          title={`Zoom ${zoom.toFixed(1)}×`}
        />
        <button className="ib" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))} title="Zoomer">
          <Plus size={16} />
        </button>
      </div>
      <div
        className="tl-scroll scroll"
        ref={scroller}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
        }}
      >
        <div className="tl-inner" style={{ width: NAME_W + contentW }}>
          <div className="tl-ruler-row">
            <div className="tl-corner" />
            <div className={`ruler ${ui.tool === "comment" ? "comment" : ""}`} style={{ width: contentW }} onPointerDown={onRulerDown}>
              {ticks.map((t) => (
                <div key={t.f}>
                  <div className={`tick ${t.major ? "major" : ""}`} style={{ left: at(t.f) }} />
                  {t.major && (
                    <div className="tick-label" style={{ left: at(t.f) }}>
                      {clockShort(t.f, fps)}
                    </div>
                  )}
                </div>
              ))}
              {version?.changed.map((r, i) => <div key={i} className="changed-bar" style={{ left: at(r.start), width: Math.max(2, (r.end - r.start) * ppf) }} />)}
              {comments.map((c) => (
                <CommentMark key={c.id} c={c} montage={montage} at={at} ppf={ppf} active={ui.commentId === c.id} onClick={() => setUi({ commentId: c.id, panel: "comments" })} />
              ))}
              <RulerHead at={at} fps={fps} marks={markFrames} ppf={ppf} />
              {draft && <div className="range-draft" style={{ left: at(Math.min(draft.a, draft.b)), width: Math.max(2, Math.abs(draft.b - draft.a) * ppf) }} />}
            </div>
          </div>
          {tracks.map((t) => {
            const Icon = trackIcon(t);
            return (
              <div key={t.id} className="tl-track">
                <div className={`tl-name ${t.hidden ? "hidden" : ""}`} title={t.hidden ? `${t.name} (masquée)` : t.name}>
                  <Icon size={16} />
                  <span className="ell">{t.name}</span>
                </div>
                <div className="lane" style={{ width: contentW }} onPointerDown={(e) => e.target === e.currentTarget && ui.tool !== "comment" && playhead.seek(frameAt(e.clientX))}>
                  {t.clips.map((c) => {
                    const sel = ui.selection?.kind === "clip" && ui.selection.id === c.id;
                    const asset = c.type === "media" ? assets.get(c.assetId) : undefined;
                    const label = c.type === "captions" ? `Sous-titres · ${c.words.slice(0, 6).map((w) => w.text).join(" ")}` : clipLabel(c, asset);
                    const kind =
                      c.type === "graphic"
                        ? "cd"
                        : c.type === "captions"
                          ? "cp"
                          : t.kind === "audio"
                            ? "mu"
                            : t.role === "main" || t.role === "voice"
                              ? "v"
                              : `br ${claudeMade(asset) ? "byc" : ""}`;
                    const thumb = asset && t.kind !== "audio" ? assetThumb(asset) : undefined;
                    const Icon = clipIcon(c, t, asset);
                    return (
                      <div
                        key={c.id}
                        className={`clip ${kind} ${sel ? "on" : ""}`}
                        style={{ left: at(c.start), width: Math.max(3, c.duration * ppf - 2) }}
                        title={`${label}\n${timecode(c.start, fps)} → ${timecode(c.start + c.duration, fps)}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setUi({ selection: { kind: "clip", id: c.id }, panel: "props" })}
                      >
                        {kind === "v" && thumb && <div className="thumbs" style={{ backgroundImage: `url("${thumb}")` }} />}
                        {kind.startsWith("br") ? thumb ? <img src={thumb} alt="" draggable={false} /> : <Icon size={12} /> : kind !== "v" && <Icon size={12} />}
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!tracks.length && <div className="empty" style={{ paddingLeft: NAME_W + 16 }}>Le montage est vide.</div>}
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

function CommentMark({ c, montage, at, ppf, active, onClick }: { c: Comment; montage?: Montage; at: (f: number) => number; ppf: number; active: boolean; onClick: () => void }) {
  if (c.anchor.kind !== "montage") return null;
  const r = montage ? resolveAnchor(c.anchor, montage) : { frame: c.anchor.frame, frameEnd: c.anchor.frameEnd, status: "same" as const };
  if (r.status === "removed") return null;
  const av = commentAvatar(c);
  const isRange = r.frameEnd !== undefined && r.frameEnd > r.frame;
  return (
    <>
      {isRange && <div className="cm-range" style={{ left: at(r.frame), width: Math.max(4, (r.frameEnd! - r.frame) * ppf) }} />}
      <button
        className={`cm ${active ? "on" : ""}`}
        style={{ left: at(r.frame) }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          playhead.seek(r.frame);
          onClick();
        }}
        title={c.thread[0]?.text}
      >
        <span className={`av ${av.cls}`}>{av.letter}</span>
      </button>
    </>
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

/** Playhead's head in the ruler, with the time. */
function RulerHead({ at, fps, marks, ppf }: { at: (f: number) => number; fps: number; marks: number[]; ppf: number }) {
  const frame = useFrame();
  // The time label gives way to comment pins it would cover (the transport shows the time anyway).
  const covered = marks.some((m) => Math.abs(m - frame) * ppf < 36);
  return <div className="ph-head" style={{ left: at(frame) }}>{!covered && <b>{clock(frame, fps)}</b>}</div>;
}

function Transport({ fps, duration }: { fps: number; duration: number }) {
  const frame = useFrame();
  const playing = usePlaying();
  return (
    <>
      <button className="ib" title="Frame précédente (←)" onClick={() => playhead.seek(playhead.get() - 1)}>
        <SkipBack size={16} />
      </button>
      <button className="ib" title="Lecture / pause (Espace)" onClick={() => playhead.toggle()}>
        {playing ? <Pause size={16} style={{ color: "var(--icon)" }} /> : <Play size={16} style={{ color: "var(--icon)" }} />}
      </button>
      <button className="ib" title="Frame suivante (→)" onClick={() => playhead.seek(playhead.get() + 1)}>
        <SkipForward size={16} />
      </button>
      <span className="tc" title={`${timecode(frame, fps)} · frame ${frame}`}>
        <span>{clock(frame, fps)}</span>
        <span className="c2">/ {clock(duration, fps)}</span>
        <span className="c3">· f{frame}</span>
      </span>
    </>
  );
}
