import type { Comment, Montage, Project, Version } from "./schema";
import { clipEnd, montageDuration, resolveAnchor } from "./timeline";

const sec = (f: number, fps: number) => `${(f / fps).toFixed(2)}s`;

/** Compact text summary of a project for Claude: ids, timings, open comments. */
export function overview(p: Project, m: Montage, comments: Comment[], versions: Version[], revision: number): string {
  const fps = m.settings.fps;
  const lines: string[] = [];
  const dur = montageDuration(m);
  lines.push(`Project "${p.name}" · montage ${m.id} ${m.settings.width}x${m.settings.height}@${fps} · ${dur}f (${sec(dur, fps)}) · rev ${revision}`);
  const last = versions.at(-1);
  if (last) lines.push(`Latest version ${last.id} (${last.status}) rev ${last.revision}: ${last.summary}`);
  lines.push(`Audio: target ${m.audio.targetLufs} LUFS, voice=${m.audio.voice}, duck=${m.audio.duck}`);
  lines.push("", "Tracks (bottom→top), frames:");
  for (const t of m.tracks) {
    lines.push(`- ${t.id} ${t.kind}${t.role ? `/${t.role}` : ""} "${t.name}"${t.hidden ? " hidden" : ""}${t.muted ? " muted" : ""}`);
    for (const c of t.clips) {
      const span = `${c.start}-${clipEnd(c)}`;
      if (c.type === "media") {
        const a = p.assets.find((x) => x.id === c.assetId);
        const extra = [
          c.speed !== 1 ? `x${c.speed}` : "",
          c.zoom ? `zoom ${c.zoom.from}→${c.zoom.to}` : "",
          c.cutout ? "cutout" : "",
          c.muted ? "muted" : c.volume !== 1 ? `vol ${c.volume}` : "",
          c.fit === "contain" ? "contain" : "",
        ].filter(Boolean);
        lines.push(`  ${c.id} media ${span} ${a ? `"${a.name}"` : c.assetId} src@${c.srcIn.toFixed(2)}s ${extra.join(" ")}`.trimEnd());
      } else if (c.type === "graphic") {
        lines.push(`  ${c.id} ${c.component} ${span} ${JSON.stringify(c.props).slice(0, 120)}`);
      } else {
        const text = c.words.map((w) => w.text).join(" ");
        lines.push(`  ${c.id} captions/${c.style} ${span} ${c.words.length} words "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`);
      }
    }
  }
  lines.push("", "Assets:");
  for (const a of p.assets) {
    const meta = [a.kind, a.duration ? `${a.duration.toFixed(1)}s` : "", a.width ? `${a.width}x${a.height}` : "", a.derived.transcript ? "transcript" : "", a.derived.cutout ? "cutout" : "", a.status !== "ready" ? a.status : ""].filter(Boolean);
    lines.push(`- ${a.id} "${a.name}" ${meta.join(" ")} (${a.provenance.type})`);
  }
  const open = comments.filter((c) => c.status !== "validated");
  if (open.length) {
    lines.push("", "Open comments:");
    for (const c of open) {
      let where = "";
      if (c.anchor.kind === "montage") {
        const r = resolveAnchor(c.anchor, m);
        where = `@${r.frame}${r.frameEnd !== undefined ? `-${r.frameEnd}` : ""}f${r.status === "removed" ? " (passage removed)" : ""}${c.anchor.region ? " zone" : c.anchor.pin ? " pin" : ""}`;
      } else where = `canvas ${c.anchor.canvasId}${c.anchor.shapeId ? `/${c.anchor.shapeId}` : ""}`;
      const lastMsg = c.thread.at(-1);
      lines.push(`- ${c.id} #${c.n} [${c.status}] ${where}: "${lastMsg?.text ?? ""}"`);
    }
  }
  return lines.join("\n");
}
