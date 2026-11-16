// Helpers for the demo scripts: they drive a running `cezane serve` through its HTTP API,
// the same way Claude drives it through MCP.
import type { CaptionWord, Op } from "@cezane/core";

export const PORT = Number(process.env.CEZANE_PORT ?? 4317);
const base = `http://127.0.0.1:${PORT}`;

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

export const edit = (ops: Op[], reason: string) => api<{ revision: number; summary: string[] }>("/api/edit", { ops, reason });

/** Ops removing every clip, so a script can rebuild the montage in one revision. */
export async function clearOps(): Promise<Op[]> {
  const s = await api<{ montage: { tracks: { clips: { id: string }[] }[] } }>("/api/state");
  return s.montage.tracks.flatMap((t) => t.clips.map((c) => ({ op: "remove_clip" as const, id: c.id })));
}

/**
 * Subtitles without a voice: each line is spread word by word over its time window
 * (longer words get more time), one caption page per line.
 */
export function subtitleWords(lines: [text: string, from: number, to: number][], fps = 30): CaptionWord[] {
  const words: CaptionWord[] = [];
  for (const [text, from, to] of lines) {
    const parts = text.split(/\s+/).filter(Boolean);
    // Balanced pages of at most 4 words: "a b c d e" → "a b c" + "d e", never a lonely word.
    const per = Math.ceil(parts.length / Math.ceil(parts.length / 4));
    const weights = parts.map((w) => 1 + w.length / 4);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = from;
    parts.forEach((w, i) => {
      const len = ((to - from) * weights[i]!) / total;
      words.push({ text: w, start: Math.round(t * fps), end: Math.round((t + len) * fps), br: i % per === 0 });
      t += len;
    });
  }
  return words;
}

/** Seconds → frames at 30 fps. */
export const f = (s: number) => Math.round(s * 30);
