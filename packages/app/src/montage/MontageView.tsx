import { type Anchor, type Comment, type Montage, type Point, type Region, resolveAnchor, type Version } from "@cezane/core";
import { ArrowUp, Columns2, Hand, MessageCircle, MousePointer2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { brandUrl, fileUrl, post } from "../api";
import { playhead, useApp, useFrame, useVersionMontage } from "../store";
import { clock } from "../ui/format";
import { attempt } from "../ui/toast";
import { commentAvatar, shotsOf } from "./clips";
import { Timeline } from "./Timeline";

type Draft =
  | { kind: "pin"; pin: Point; frame: number }
  | { kind: "region"; region: Region; frame: number }
  | { kind: "range"; frame: number; frameEnd?: number };

const frameOf = (t: number, fps: number) => Math.floor(t * fps + 1e-3);

export function MontageView() {
  const { state, ui, setUi, version } = useApp();
  const montage = useVersionMontage(version, state?.montage);
  const compareVersion = ui.compare ? (state?.versions.find((v) => v.id === ui.compareId) ?? previousReady(state?.versions ?? [], version)) : undefined;
  const compareMontage = useVersionMontage(compareVersion, undefined);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 400, h: 700 });
  const [draft, setDraft] = useState<Draft & { at: { x: number; y: number } }>();
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const fps = version?.fps ?? state?.montage.settings.fps ?? 30;
  const dims = montage?.settings ?? state?.montage.settings ?? { width: 1080, height: 1920 };

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    // Room for the frame: 36 px above (label), the floating toolbar below.
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 64, h: el.clientHeight - 36 - 20 - 96 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Player API: frame-accurate seek/step, wired to the playhead store.
  useEffect(() => {
    const v = videoA.current;
    if (!v || !version?.file) return;
    let raf = 0;
    let rvfc = 0;
    const sync = () => {
      const b = videoB.current;
      if (b && Math.abs(b.currentTime - v.currentTime) > 0.5 / fps) b.currentTime = v.currentTime;
    };
    const tick = () => {
      playhead.set(frameOf(v.currentTime, fps), !v.paused);
      sync();
    };
    const loop = () => {
      tick();
      if (!v.paused) {
        if ("requestVideoFrameCallback" in v) rvfc = v.requestVideoFrameCallback(loop);
        else raf = requestAnimationFrame(loop);
      }
    };
    const onPlay = () => {
      videoB.current?.play().catch(() => {});
      loop();
    };
    const onPause = () => {
      videoB.current?.pause();
      tick();
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", tick);
    v.addEventListener("loadedmetadata", tick);
    playhead.register({
      seek: (f) => {
        const max = (version.durationFrames ?? 1) - 1;
        const clamped = Math.max(0, Math.min(max, Math.round(f)));
        v.currentTime = (clamped + 0.5) / fps;
        if (videoB.current) videoB.current.currentTime = v.currentTime;
        playhead.set(clamped);
      },
      toggle: () => (v.paused ? v.play().catch(() => {}) : v.pause()),
      playing: () => !v.paused,
    });
    return () => {
      cancelAnimationFrame(raf);
      if (rvfc && "cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(rvfc);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", tick);
      v.removeEventListener("loadedmetadata", tick);
      playhead.register(undefined);
    };
  }, [version?.id, version?.file, fps, version?.durationFrames, ui.compare]);

  // Keep the current frame when switching version.
  useEffect(() => {
    const f = playhead.get();
    const v = videoA.current;
    if (v) v.addEventListener("loadedmetadata", () => playhead.seek(f), { once: true });
  }, [version?.id]);

  // Transport keys: Space, ←/→, J/K/L.
  useEffect(() => {
    let rewind: ReturnType<typeof setInterval> | undefined;
    const stopRewind = () => {
      clearInterval(rewind);
      rewind = undefined;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select") || e.metaKey || e.ctrlKey) return;
      const v = videoA.current;
      if (!v) return;
      const k = e.key.toLowerCase();
      if (e.key === " ") {
        e.preventDefault();
        stopRewind();
        playhead.toggle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        v.pause();
        playhead.seek(playhead.get() + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
      } else if (k === "k") {
        stopRewind();
        v.pause();
      } else if (k === "l") {
        stopRewind();
        if (!v.paused) v.playbackRate = Math.min(4, v.playbackRate * 2);
        else {
          v.playbackRate = 1;
          v.play().catch(() => {});
        }
      } else if (k === "j") {
        v.pause();
        stopRewind();
        rewind = setInterval(() => {
          const f = playhead.get() - 1;
          if (f <= 0) stopRewind();
          playhead.seek(f);
        }, 1000 / fps);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stopRewind();
      window.removeEventListener("keydown", onKey);
    };
  }, [fps]);

  // Screen size: fit the montage aspect ratio, two screens side by side in A/B mode.
  const count = compareVersion ? 2 : 1;
  const aspect = dims.width / dims.height;
  const maxW = (box.w - (count - 1) * 32) / count;
  const screenH = Math.max(120, Math.min(box.h, maxW / aspect));
  const screenW = screenH * aspect;

  const openComposer = useCallback(
    (d: Draft, at: { x: number; y: number }) => {
      videoA.current?.pause();
      setDraft({ ...d, at });
    },
    [],
  );

  const submit = async (text: string) => {
    if (!draft || !version) return;
    const anchor: Anchor = {
      kind: "montage",
      montageId: version.montageId,
      versionId: version.id,
      frame: draft.frame,
      ...(draft.kind === "pin" ? { pin: draft.pin } : draft.kind === "region" ? { region: draft.region } : { frameEnd: draft.frameEnd }),
    };
    const snapshot = captureFrame(videoA.current);
    const c = await attempt(() => post<Comment>("/api/comments", { anchor, text, snapshot }));
    if (c) setUi({ commentId: c.id, panel: "comments" });
    setDraft(undefined);
  };

  const noVersion = !version?.file;

  return (
    <>
      <div className="cv" ref={stage}>
        {noVersion ? (
          <div className="no-version">
            <img src={brandUrl("mood-montage.png")} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
            <div className="t13 s">
              {version?.status === "rendering" ? `Rendu de V${version.n} en cours… ${Math.round(version.progress * 100)} %` : "Pas encore de version rendue"}
            </div>
            <div>Importe des rushes, demande un montage à Claude, puis clique sur « Rendre ».</div>
          </div>
        ) : (
          <div className="stage">
            {compareVersion && (
              <Screen
                label={`B · V${compareVersion.n}`}
                version={compareVersion}
                montage={compareMontage}
                w={screenW}
                h={screenH}
                videoRef={videoB}
                muted
                interactive={false}
              />
            )}
            <Screen
              label={compareVersion ? `A · V${version!.n}` : undefined}
              version={version!}
              montage={montage}
              w={screenW}
              h={screenH}
              videoRef={videoA}
              interactive
              stageRef={stage}
              onDraft={openComposer}
              draft={draft}
            />
          </div>
        )}
        {draft && <Composer draft={draft} fps={fps} versionN={version?.n} onCancel={() => setDraft(undefined)} onSubmit={submit} />}
        <Toolbar />
      </div>
      <Timeline
        montage={montage}
        version={version}
        onRangeComment={(a, b) => {
          const r = stage.current?.getBoundingClientRect();
          openComposer(b > a ? { kind: "range", frame: a, frameEnd: b } : { kind: "range", frame: a }, { x: (r?.width ?? 600) / 2 - 132, y: (r?.height ?? 600) - 240 });
          playhead.seek(a);
        }}
      />
    </>
  );
}

function previousReady(versions: Version[], v?: Version) {
  if (!v) return undefined;
  return [...versions].reverse().find((x) => x.n < v.n && x.status === "ready" && x.file);
}

/** JPEG of the displayed frame, at most 540 px wide. */
function captureFrame(v: HTMLVideoElement | null): string | undefined {
  if (!v || !v.videoWidth) return undefined;
  try {
    const scale = Math.min(1, 540 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } catch {
    return undefined;
  }
}

type ScreenProps = {
  label?: string;
  version: Version;
  montage?: Montage;
  w: number;
  h: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  muted?: boolean;
  interactive: boolean;
  stageRef?: React.RefObject<HTMLDivElement | null>;
  onDraft?: (d: Draft, at: { x: number; y: number }) => void;
  draft?: Draft;
};

function Screen({ label, version, montage, w, h, videoRef, muted, interactive, stageRef, onDraft, draft }: ScreenProps) {
  const { ui, setUi, state } = useApp();
  const frame = useFrame();
  const overlay = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Region>();
  const [view, setView] = useState({ s: 1, x: 0, y: 0 }); // hand tool: zoom & pan to inspect details
  const fps = version.fps;

  useEffect(() => {
    setView({ s: 1, x: 0, y: 0 });
  }, [version.id]);

  const norm = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    if (ui.tool === "hand") {
      const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    if (ui.tool !== "comment") {
      playhead.toggle();
      return;
    }
    const a = norm(e);
    const f = playhead.get();
    const move = (ev: PointerEvent) => {
      const b = norm(ev);
      setRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setRect(undefined);
      const b = norm(ev);
      const s = stageRef?.current?.getBoundingClientRect();
      const at = s ? { x: Math.min(s.width - 276, ev.clientX - s.left + 24), y: Math.min(s.height - 150, Math.max(8, ev.clientY - s.top - 40)) } : { x: 20, y: 20 };
      const dist = Math.hypot((b.x - a.x) * w, (b.y - a.y) * h);
      if (dist < 6) onDraft?.({ kind: "pin", pin: a, frame: f }, at);
      else onDraft?.({ kind: "region", region: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }, frame: f }, at);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Pins and zones of the comments around the current frame (±0.5 s, or inside their range).
  const visible = interactive
    ? (state?.comments ?? []).flatMap((c) => {
        if (c.anchor.kind !== "montage" || (!c.anchor.pin && !c.anchor.region)) return [];
        const r = montage ? resolveAnchor(c.anchor, montage) : { frame: c.anchor.frame, frameEnd: c.anchor.frameEnd, status: "same" };
        if (r.status === "removed") return [];
        const inside = r.frameEnd !== undefined ? frame >= r.frame && frame <= r.frameEnd : Math.abs(frame - r.frame) <= fps / 2;
        return inside || ui.commentId === c.id && Math.abs(frame - r.frame) <= fps ? [c] : [];
      })
    : [];

  // Label above the frame: the version, then what is said at the playhead (or the version summary).
  const shots = useMemo(() => shotsOf(montage), [montage]);
  const shot = shots.find((s) => frame >= s.clip.start && frame < s.clip.start + s.clip.duration);
  const caption = shot?.phrase ?? version.summary;

  return (
    <div className="fw">
      <div className="fl" style={{ maxWidth: w }}>
        <b>{label ?? `V${version.n}`}</b>
        <span className="ell">{caption}</span>
      </div>
    <div className="fr" style={{ width: w, height: h, overflow: view.s > 1 ? "hidden" : "visible" }} onWheel={(e) => {
      if (ui.tool !== "hand") return;
      setView((v) => ({ ...v, s: Math.min(6, Math.max(1, v.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }));
    }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <video ref={videoRef} src={fileUrl(version.file!)} muted={muted} playsInline preload="auto" style={{ width: "100%", height: "100%", transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: "center" }} />
      </div>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: "center" }}>
        <div ref={overlay} className={`overlay ${interactive ? ui.tool : ""}`} onPointerDown={onDown}>
          {visible.map((c) => <Mark key={c.id} c={c} active={ui.commentId === c.id} onClick={() => setUi({ commentId: c.id, panel: "comments" })} />)}
          {rect && <div className="zone draft-rect" style={pct(rect)} />}
          {draft?.kind === "region" && <div className="zone draft-rect" style={pct(draft.region)} />}
          {draft?.kind === "pin" && (
            <div className="pin on" style={{ left: `${draft.pin.x * 100}%`, top: `${draft.pin.y * 100}%` }}>
              <span className="av me">P</span>
            </div>
          )}
        </div>
      </div>
      {view.s > 1 && (
        <button className="btn zoom-reset" onClick={() => setView({ s: 1, x: 0, y: 0 })}>
          {Math.round(view.s * 100)} % · réinitialiser
        </button>
      )}
    </div>
    </div>
  );
}

const pct = (r: Region) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

/** A comment on the frame: Figma's pin (round, sharp bottom-left corner), plus its zone if it has one. */
function Mark({ c, active, onClick }: { c: Comment; active: boolean; onClick: () => void }) {
  if (c.anchor.kind !== "montage") return null;
  const av = commentAvatar(c);
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const pin = (style?: React.CSSProperties) => (
    <div className={`pin ${active ? "on" : ""}`} style={style} onPointerDown={stop} onClick={onClick} title={c.thread[0]?.text}>
      <span className={`av ${av.cls}`}>{av.letter}</span>
    </div>
  );
  if (c.anchor.region)
    return (
      <div className={`zone ${c.status === "validated" ? "done" : ""} ${active ? "on" : ""}`} style={pct(c.anchor.region)} onPointerDown={stop} onClick={onClick} title={c.thread[0]?.text}>
        {pin()}
      </div>
    );
  return pin({ left: `${c.anchor.pin!.x * 100}%`, top: `${c.anchor.pin!.y * 100}%` });
}

function Composer({ draft, fps, versionN, onCancel, onSubmit }: { draft: Draft & { at: { x: number; y: number } }; fps: number; versionN?: number; onCancel: () => void; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    await onSubmit(text.trim());
    setBusy(false);
  };
  const where = [
    versionN ? `V${versionN}` : undefined,
    draft.kind === "range" && draft.frameEnd !== undefined ? `${clock(draft.frame, fps)} → ${clock(draft.frameEnd, fps)}` : clock(draft.frame, fps),
    draft.kind === "pin" ? "épingle" : draft.kind === "region" ? "zone" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="pop composer" style={{ left: Math.max(8, draft.at.x), top: Math.max(8, draft.at.y) }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="body">
        <span className="av me">P</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="c2" title={`frame ${draft.frame}`}>{where}</div>
      <textarea
        rows={3}
        autoFocus
        placeholder="Ton commentaire pour Claude…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || !e.shiftKey)) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") onCancel();
          e.stopPropagation();
        }}
      />
        </div>
      </div>
      <div className="foot">
        <span className="c3">⏎ pour ajouter</span>
        <div className="sp" />
        <button className="btn ghost" onClick={onCancel}>
          Annuler
        </button>
        <button className="send" disabled={!text.trim() || busy} onClick={send} title="Ajouter">
          <ArrowUp size={14} />
        </button>
      </div>
    </div>
  );
}

/** Floating toolbar (Figma UI3): tools, then the A/B comparison. Transport lives in the timeline header. */
function Toolbar() {
  const { ui, setUi, state } = useApp();
  const canCompare = (state?.versions.filter((v) => v.status === "ready" && v.file).length ?? 0) >= 2;
  return (
    <div className="tb">
      <button className={`t ${ui.tool === "select" ? "on" : ""}`} title="Sélection (V)" onClick={() => setUi({ tool: "select" })}>
        <MousePointer2 size={16} />
      </button>
      <button className={`t ${ui.tool === "hand" ? "on" : ""}`} title="Main : zoomer/déplacer l'image (H)" onClick={() => setUi({ tool: "hand" })}>
        <Hand size={16} />
      </button>
      <button className={`t ${ui.tool === "comment" ? "on" : ""}`} title="Commentaire (C) : clic = épingle, glisser = zone, glisser sur la règle = plage" onClick={() => setUi({ tool: "comment" })}>
        <MessageCircle size={16} />
      </button>
      <span className="dv" />
      <button className={`t ${ui.compare ? "on" : ""}`} disabled={!canCompare} title="Comparer deux versions côte à côte (A/B)" onClick={() => setUi((u) => ({ compare: !u.compare }))}>
        <Columns2 size={16} />
      </button>
    </div>
  );
}
