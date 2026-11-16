import type { Asset, Version } from "@cezane/core";
import { Check, ChevronDown, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { playhead, useApp, useVersionMontage } from "../store";
import { clockShort, relTime } from "../ui/format";
import { claudeMade, clipIcon, clipLabel, openCommentsByClip, shotsOf } from "./clips";

/** Left panel, "Plans" tab: the rendered versions, then the shots of the displayed version. */
export function PlansTab() {
  const { state, ui, setUi, version } = useApp();
  const montage = useVersionMontage(version, state?.montage);
  const versions = state?.versions ?? [];
  const assets = useMemo(() => new Map(state?.project.assets.map((a) => [a.id, a])), [state?.project.assets]);
  const shots = useMemo(() => shotsOf(montage), [montage]);
  const comments = useMemo(() => openCommentsByClip(state?.comments ?? []), [state?.comments]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const fps = version?.fps ?? montage?.settings.fps ?? 30;
  const duration = version?.durationFrames ?? Math.max(0, ...shots.map((s) => s.clip.start + s.clip.duration));
  const selected = ui.selection?.kind === "clip" ? ui.selection.id : undefined;

  const pick = (clipId: string, start: number) => {
    setUi({ selection: { kind: "clip", id: clipId } });
    playhead.seek(start);
  };

  return (
    <>
      <div className="sec">
        <div className="sh">Versions</div>
        <div className="scroll" style={{ maxHeight: 4 * 32 }}>
          {[...versions].reverse().map((v) => (
            <VersionRow key={v.id} v={v} on={v.id === version?.id} onClick={() => setUi({ versionId: v.id })} />
          ))}
        </div>
        {!versions.length && <div className="empty">Pas encore de version rendue.</div>}
      </div>
      <div className="sh">
        Plans<span className="r">{duration ? clockShort(duration, fps) : ""}</span>
      </div>
      <div className="scroll fill rows">
        {!shots.length && <div className="empty">Le montage est vide.</div>}
        {shots.map((s) => {
          const asset = s.clip.type === "media" ? assets.get(s.clip.assetId) : undefined;
          const Icon = clipIcon(s.clip, s.track, asset);
          const isSel = selected === s.clip.id;
          const childSel = s.children.some((c) => c.clip.id === selected);
          const expanded = open[s.clip.id] ?? (isSel || childSel);
          return (
            <div key={s.clip.id}>
              <div
                className={`row ${isSel ? "sel" : childSel ? "sel2" : ""} ${claudeMade(asset) ? "cl" : ""}`}
                onClick={() => pick(s.clip.id, s.clip.start)}
                title={s.phrase ?? clipLabel(s.clip, asset)}
              >
                <button
                  className="dis"
                  style={{ visibility: s.children.length ? "visible" : "hidden" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen((o) => ({ ...o, [s.clip.id]: !expanded }));
                  }}
                >
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <Icon size={16} />
                <span className="nm">{s.phrase ?? clipLabel(s.clip, asset)}</span>
                <CommentDot n={comments.get(s.clip.id)?.length} />
                {asset?.status === "error" && <TriangleAlert size={12} style={{ color: "var(--y-1000)" }} />}
                <span className="r">{clockShort(s.clip.start, fps)}</span>
              </div>
              {expanded &&
                s.children.map(({ clip, track }) => {
                  const a: Asset | undefined = clip.type === "media" ? assets.get(clip.assetId) : undefined;
                  const CIcon = clipIcon(clip, track, a);
                  const tone = clip.type === "graphic" ? "comp" : claudeMade(a) ? "cl" : "";
                  return (
                    <div
                      key={clip.id}
                      className={`row ${selected === clip.id ? "sel" : isSel || childSel ? "sel2" : ""} ${tone}`}
                      style={{ "--i": 1 } as React.CSSProperties}
                      onClick={() => pick(clip.id, clip.start)}
                      title={`${track.name} · ${clipLabel(clip, a)}`}
                    >
                      <span className="dis" />
                      <CIcon size={16} />
                      <span className="nm">{clipLabel(clip, a)}</span>
                      <CommentDot n={comments.get(clip.id)?.length} />
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </>
  );
}

function VersionRow({ v, on, onClick }: { v: Version; on: boolean; onClick: () => void }) {
  return (
    <div className="row" onClick={onClick} title={v.summary || undefined}>
      <span className="dis">{on && <Check size={12} style={{ color: "var(--icon)" }} />}</span>
      <span className={`nm ${on ? "s" : ""}`}>
        V{v.n}
        {v.summary ? ` · ${v.summary}` : ""}
      </span>
      {v.status === "rendering" ? (
        <span className={`bd ${v.author === "claude" ? "c" : "b"}`}>
          <Loader2 size={10} className="spin" /> {Math.round(v.progress * 100)} %
        </span>
      ) : v.status === "error" ? (
        <span className="bd r">erreur</span>
      ) : (
        <span className="r">{relTime(v.createdAt)}</span>
      )}
    </div>
  );
}

/** Avatar marking a shot that has open comments. */
function CommentDot({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="av me xs" title={`${n} commentaire${n > 1 ? "s" : ""}`}>
      P
    </span>
  );
}
