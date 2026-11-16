import { existsSync } from "node:fs";
import type { Asset, MediaClip, Montage } from "@cezane/core";
import { clipEnd, montageDuration, stableStringify } from "@cezane/core";
import { ffmpeg, sha256 } from "./proc";

type Audible = { clip: MediaClip; wav: string; bus: "voice" | "music" };

const VOICE_CHAIN: Record<Montage["audio"]["voice"], string> = {
  none: "anull",
  clean: "highpass=f=80,afftdn=nf=-28:tn=1,acompressor=threshold=-20dB:ratio=3:attack=5:release=60:makeup=2",
  podcast:
    "highpass=f=90,afftdn=nf=-25:tn=1,equalizer=f=250:t=q:w=1:g=-3,equalizer=f=3500:t=q:w=1.2:g=3,deesser=i=0.4,acompressor=threshold=-22dB:ratio=4:attack=3:release=80:makeup=3,alimiter=limit=0.95",
};

function atempo(speed: number): string {
  if (speed === 1) return "";
  const parts: string[] = [];
  let s = speed;
  while (s > 2) (parts.push("atempo=2"), (s /= 2));
  while (s < 0.5) (parts.push("atempo=0.5"), (s /= 0.5));
  parts.push(`atempo=${s.toFixed(4)}`);
  return `,${parts.join(",")}`;
}

function audibleClips(m: Montage, assets: Map<string, Asset>, wavPath: (a: Asset) => string | undefined): Audible[] {
  const out: Audible[] = [];
  for (const t of m.tracks) {
    if (t.muted) continue;
    for (const c of t.clips) {
      if (c.type !== "media" || c.muted || c.volume === 0) continue;
      const a = assets.get(c.assetId);
      const wav = a && wavPath(a);
      if (!a || !wav) continue;
      const bus = t.role === "music" || (t.kind === "audio" && t.role !== "voice" && t.role !== "sfx") ? "music" : "voice";
      out.push({ clip: c, wav, bus });
    }
  }
  return out;
}

/** Cache key of the mixed soundtrack: a change of sound never re-renders images, and vice versa. */
export function audioKey(m: Montage, assets: Map<string, Asset>, wavPath: (a: Asset) => string | undefined): string {
  const clips = audibleClips(m, assets, wavPath).map(({ clip: c, bus }) => [assets.get(c.assetId)!.hash, bus, c.start, c.duration, c.srcIn, c.speed, c.volume, c.fadeIn, c.fadeOut]);
  return sha256(stableStringify({ v: 2, fps: m.settings.fps, dur: montageDuration(m), audio: m.audio, clips }));
}

/**
 * Mixes the soundtrack with ffmpeg: clips placed on the timeline, voice chain, music ducked
 * under the voice, then two-pass loudness normalization to the target LUFS.
 */
export async function mixAudio(
  m: Montage,
  assets: Map<string, Asset>,
  wavPath: (a: Asset) => string | undefined,
  out: string,
  onProgress?: (p: number) => void,
): Promise<void> {
  if (existsSync(out)) return;
  const fps = m.settings.fps;
  const dur = montageDuration(m) / fps;
  const clips = audibleClips(m, assets, wavPath);
  const tmp = `${out}.mix.wav`;
  const inputs: string[] = [];
  const filters: string[] = [];
  const voice: string[] = [];
  const music: string[] = [];
  clips.forEach(({ clip: c, wav, bus }, i) => {
    inputs.push("-i", wav);
    const len = c.duration / fps;
    const delay = Math.round((c.start / fps) * 1000);
    const fades = [
      c.fadeIn ? `afade=t=in:st=0:d=${(c.fadeIn / fps).toFixed(3)}` : "",
      c.fadeOut ? `afade=t=out:st=${Math.max(0, len - c.fadeOut / fps).toFixed(3)}:d=${(c.fadeOut / fps).toFixed(3)}` : "",
    ].filter(Boolean);
    filters.push(
      `[${i}:a]atrim=start=${c.srcIn.toFixed(3)}:duration=${(len * c.speed).toFixed(3)},asetpts=PTS-STARTPTS${atempo(c.speed)},volume=${c.volume}${fades.length ? `,${fades.join(",")}` : ""},adelay=${delay}|${delay}[c${i}]`,
    );
    (bus === "voice" ? voice : music).push(`[c${i}]`);
  });
  const total = dur.toFixed(3);
  const mixOf = (labels: string[], name: string) =>
    labels.length === 1 ? `${labels[0]}anull[${name}]` : `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[${name}]`;
  let last: string;
  if (!clips.length) {
    inputs.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`);
    filters.push(`[0:a]atrim=duration=${total}[mix]`);
    last = "mix";
  } else {
    if (voice.length) filters.push(mixOf(voice, "vraw"), `[vraw]${VOICE_CHAIN[m.audio.voice]}[voice]`);
    if (music.length) filters.push(mixOf(music, "mraw"));
    if (voice.length && music.length) {
      if (m.audio.duck) {
        const thr = Math.pow(10, -30 / 20).toFixed(4);
        const ratio = Math.min(20, Math.max(2, Math.abs(m.audio.duckDb) / 1.5)).toFixed(1);
        filters.push(`[voice]asplit=2[v1][vsc]`, `[mraw][vsc]sidechaincompress=threshold=${thr}:ratio=${ratio}:attack=30:release=400[music]`, `[v1][music]amix=inputs=2:normalize=0[mix0]`);
      } else filters.push(`[voice][mraw]amix=inputs=2:normalize=0[mix0]`);
    } else filters.push(`[${voice.length ? "voice" : "mraw"}]anull[mix0]`);
    filters.push(`[mix0]apad,atrim=duration=${total},aresample=48000[mix]`);
    last = "mix";
  }
  await ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", `[${last}]`, "-ac", "2", "-c:a", "pcm_s16le", tmp], {
    duration: dur,
    onProgress: (p) => onProgress?.(p * 0.6),
  });
  // Two-pass loudnorm: measure, then apply linearly.
  const t = m.audio.targetLufs;
  const measure = await ffmpeg(["-i", tmp, "-af", `loudnorm=I=${t}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"]);
  const json = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(measure.stderr)?.[0];
  let ln = `loudnorm=I=${t}:TP=-1.5:LRA=11`;
  if (json) {
    const j = JSON.parse(json) as Record<string, string>;
    if (Number.isFinite(Number(j.input_i)) && Number(j.input_i) > -70)
      ln += `:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  }
  await ffmpeg(["-i", tmp, "-af", `${ln},aresample=48000`, "-c:a", "aac", "-b:a", "192k", out], { duration: dur, onProgress: (p) => onProgress?.(0.6 + p * 0.4) });
  await Bun.$`rm -f ${tmp}`.quiet();
}

export const audibleDuration = (m: Montage) => Math.max(0, ...m.tracks.flatMap((t) => t.clips.map(clipEnd)));
