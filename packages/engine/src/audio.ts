import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Asset, MediaClip, Montage, MusicMode, Track } from "@cezane/core";
import { BED_DB, clipEnd, montageDuration, musicMode, stableStringify } from "@cezane/core";
import { ffmpeg, REPO_DIR, sha256 } from "./proc";

/**
 * Three buses: voice (A-roll and voice tracks, through the voice chain), music (under the voice: bed
 * or sidechain), sfx (straight in, after the ducking, before loudnorm).
 */
export type Bus = "voice" | "music" | "sfx";
/** A clip that will be heard, with its fades resolved in seconds (explicit fade, micro-fade or none). */
export type Audible = { clip: MediaClip; wav: string; bus: Bus; fadeIn: number; fadeOut: number };

const SR = 48000;
/** Fade at every hard cut of a voice/music clip without an explicit fade: no click at jump cuts. */
export const MICRO_FADE = 0.008;
/** True peak loudnorm aims at, so the delivered AAC stays at or under -1.5 dBTP. */
const LOUDNORM_TP = -2;
/** RNNoise model of the voice presets (see assets/rnnoise/README.md); afftdn when it is missing. */
export const RNNOISE_MODEL = join(REPO_DIR, "assets/rnnoise/bd.rnnn");

/** Escapes a filter option value inside a -filter_complex graph (ffmpeg's two escaping levels). */
export const ffValue = (v: string) => v.replace(/[\\':]/g, "\\$&").replace(/[\\'[\],;]/g, "\\$&");

/** Voice processing chain, and its latency in samples at 48 kHz (trimmed off after the chain to keep lip sync). */
export type VoiceChain = { filter: string; latency: number };

export function voiceChain(preset: Montage["audio"]["voice"], model: string | null = existsSync(RNNOISE_MODEL) ? RNNOISE_MODEL : null): VoiceChain {
  if (preset === "none") return { filter: "anull", latency: 0 };
  const podcast = preset === "podcast";
  // arnndn delays by one 10 ms frame, afftdn by 25 ms (measured at 48 kHz).
  const [denoise, latency] = model
    ? [`arnndn=m=${ffValue(model)}:mix=${podcast ? 0.9 : 0.85}`, 480]
    : [`afftdn=nf=${podcast ? -25 : -28}:tn=1`, 1200];
  const filter = podcast
    ? `highpass=f=90,${denoise},equalizer=f=250:t=q:w=1:g=-3,equalizer=f=3500:t=q:w=1.2:g=3,deesser=i=0.4,acompressor=threshold=-22dB:ratio=4:attack=3:release=80:makeup=3,alimiter=limit=0.95:latency=1`
    : `highpass=f=80,${denoise},acompressor=threshold=-20dB:ratio=3:attack=5:release=60:makeup=2`;
  return { filter, latency };
}

export function busOf(t: Pick<Track, "kind" | "role">): Bus {
  if (t.role === "sfx") return "sfx";
  if (t.role === "music" || (t.kind === "audio" && t.role !== "voice")) return "music";
  return "voice";
}

/** b plays the source right where a stops (a split for a zoom, not a cut): no fade between them. */
function continuous(a: MediaClip, b: MediaClip, fps: number): boolean {
  return (
    a.assetId === b.assetId &&
    clipEnd(a) === b.start &&
    a.speed === b.speed &&
    a.volume === b.volume &&
    Math.abs(a.srcIn + (a.duration / fps) * a.speed - b.srcIn) < 0.5 / fps
  );
}

export function audibleClips(m: Montage, assets: Map<string, Asset>, wavPath: (a: Asset) => string | undefined): Audible[] {
  const fps = m.settings.fps;
  const out: Audible[] = [];
  for (const t of m.tracks) {
    if (t.muted) continue;
    const bus = busOf(t);
    const heard: { clip: MediaClip; wav: string }[] = [];
    for (const c of t.clips) {
      if (c.type !== "media" || c.muted || c.volume === 0) continue;
      const a = assets.get(c.assetId);
      const wav = a && wavPath(a);
      if (wav) heard.push({ clip: c, wav });
    }
    heard.sort((x, y) => x.clip.start - y.clip.start);
    heard.forEach(({ clip: c, wav }, i) => {
      const prev = heard[i - 1]?.clip;
      const next = heard[i + 1]?.clip;
      out.push({
        clip: c,
        wav,
        bus,
        // An SFX keeps its attack: micro-fade on its tail only.
        fadeIn: c.fadeIn ? c.fadeIn / fps : bus !== "sfx" && !(prev && continuous(prev, c, fps)) ? MICRO_FADE : 0,
        fadeOut: c.fadeOut ? c.fadeOut / fps : !(next && continuous(c, next, fps)) ? MICRO_FADE : 0,
      });
    });
  }
  return out;
}

function atempo(speed: number): string {
  if (speed === 1) return "";
  const parts: string[] = [];
  let s = speed;
  while (s > 2) (parts.push("atempo=2"), (s /= 2));
  while (s < 0.5) (parts.push("atempo=0.5"), (s /= 0.5));
  parts.push(`atempo=${s.toFixed(4)}`);
  return `,${parts.join(",")}`;
}

function clipFilter(a: Audible, i: number, fps: number): string {
  const c = a.clip;
  const len = c.duration / fps;
  const delay = Math.round((c.start / fps) * 1000);
  const fades = [
    a.fadeIn ? `,afade=t=in:st=0:d=${a.fadeIn.toFixed(3)}` : "",
    a.fadeOut ? `,afade=t=out:st=${Math.max(0, len - a.fadeOut).toFixed(3)}:d=${a.fadeOut.toFixed(3)}` : "",
  ].join("");
  // adelay emits its leading silence without timestamps: re-stamp from the sample count, or amix and atrim misplace the end.
  return `[${i}:a]atrim=start=${c.srcIn.toFixed(3)}:duration=${(len * c.speed).toFixed(3)},asetpts=PTS-STARTPTS${atempo(c.speed)},volume=${c.volume}${fades},adelay=${delay}|${delay},asetpts=N/SR/TB[c${i}]`;
}

export type MixOptions = {
  fps: number;
  total: number; // seconds
  voice: VoiceChain;
  mode: MusicMode;
  duckDb: number; // sidechain: max reduction
  musicGainDb?: number; // bed: gain of the music bus (from bedGainDb)
};

/** ffmpeg inputs and filtergraph of the mix, ending on [mix]. Pure, so the tests can read it. */
export function mixGraph(clips: Audible[], o: MixOptions): { inputs: string[]; graph: string } {
  const total = o.total.toFixed(3);
  if (!clips.length) return { inputs: ["-f", "lavfi", "-i", `anullsrc=r=${SR}:cl=stereo`], graph: `[0:a]atrim=duration=${total}[mix]` };
  const inputs: string[] = [];
  const filters: string[] = [];
  const buses: Record<Bus, string[]> = { voice: [], music: [], sfx: [] };
  clips.forEach((a, i) => {
    inputs.push("-i", a.wav);
    filters.push(clipFilter(a, i, o.fps));
    buses[a.bus].push(`[c${i}]`);
  });
  const mixOf = (labels: string[], name: string) =>
    labels.length === 1 ? `${labels[0]}anull[${name}]` : `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[${name}]`;
  const outs: string[] = [];
  if (buses.voice.length) {
    const { filter, latency } = o.voice;
    // Pad so the chain flushes the last samples, then drop its latency: the voice stays on the lips.
    filters.push(mixOf(buses.voice, "vraw"), latency ? `[vraw]apad=pad_len=${latency},${filter},atrim=start_sample=${latency},asetpts=PTS-STARTPTS[voice]` : `[vraw]${filter}[voice]`);
    outs.push("[voice]");
  }
  if (buses.music.length) {
    filters.push(mixOf(buses.music, "mraw"));
    const gain = o.mode === "bed" && o.musicGainDb ? `volume=${o.musicGainDb.toFixed(2)}dB` : "anull";
    if (o.mode === "sidechain" && buses.voice.length) {
      // Keyed by the voice bus only: SFX never pull the music down. The key is padded with silence:
      // sidechaincompress stops at its shorter input, which cut the music where the voice ended.
      const thr = Math.pow(10, -30 / 20).toFixed(4);
      const ratio = Math.min(20, Math.max(2, Math.abs(o.duckDb) / 1.5)).toFixed(1);
      filters.push(`[voice]asplit=2[vmix][vkey]`, `[vkey]apad[vpad]`, `[mraw][vpad]sidechaincompress=threshold=${thr}:ratio=${ratio}:attack=30:release=400[music]`);
      outs[0] = "[vmix]";
    } else filters.push(`[mraw]${gain}[music]`);
    outs.push("[music]");
  }
  if (buses.sfx.length) {
    filters.push(mixOf(buses.sfx, "sfx"));
    outs.push("[sfx]");
  }
  filters.push(`${outs.join("")}${outs.length > 1 ? `amix=inputs=${outs.length}:normalize=0` : "anull"},apad,atrim=duration=${total},aresample=${SR}[mix]`);
  return { inputs, graph: filters.join(";") };
}

/** Gain (dB) on the music bus that puts it `bedDb` under the voice, from their integrated loudness. */
export const bedGainDb = (voiceLufs: number, musicLufs: number, bedDb = BED_DB) =>
  Math.round(Math.min(20, Math.max(-40, voiceLufs - Math.abs(bedDb) - musicLufs)) * 100) / 100;

const clipKey = ({ clip: c, bus, fadeIn, fadeOut }: Audible, assets: Map<string, Asset>) =>
  [assets.get(c.assetId)!.hash, bus, c.start, c.duration, c.srcIn, c.speed, c.volume, fadeIn, fadeOut];

/** Cache key of the mixed soundtrack: a change of sound never re-renders images, and vice versa. */
export function audioKey(m: Montage, assets: Map<string, Asset>, wavPath: (a: Asset) => string | undefined): string {
  const clips = audibleClips(m, assets, wavPath).map((a) => clipKey(a, assets));
  const audio = { ...m.audio, duck: musicMode(m.audio), bedDb: m.audio.bedDb ?? BED_DB, chain: voiceChain(m.audio.voice).filter };
  return sha256(stableStringify({ v: 3, fps: m.settings.fps, dur: montageDuration(m), audio, clips }));
}

/** Integrated loudness (LUFS) of some clips mixed alone through the same graph; cached in `dir` by content. */
export async function busLoudness(clips: Audible[], o: MixOptions, assets: Map<string, Asset>, dir: string): Promise<number | undefined> {
  const opts = { ...o, mode: "off" as const, musicGainDb: undefined };
  const file = join(dir, `${sha256(stableStringify({ v: 1, clips: clips.map((a) => clipKey(a, assets)), fps: o.fps, total: o.total, chain: o.voice.filter }))}.lufs.json`);
  if (existsSync(file)) return ((await Bun.file(file).json()) as { lufs: number | null }).lufs ?? undefined;
  const { inputs, graph } = mixGraph(clips, opts);
  const r = await ffmpeg([...inputs, "-filter_complex", `${graph};[mix]ebur128[out]`, "-map", "[out]", "-f", "null", "-"]);
  const i = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split("Summary:").at(-1) ?? "");
  const lufs = i && Number(i[1]) > -70 ? Number(i[1]) : null;
  await Bun.write(file, JSON.stringify({ lufs }));
  return lufs ?? undefined;
}

/**
 * Mixes the soundtrack with ffmpeg: clips placed on the timeline, voice chain, music as a constant
 * bed under the voice (or sidechain-ducked), SFX on top, then two-pass loudness normalization.
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
  const o: MixOptions = { fps, total: dur, voice: voiceChain(m.audio.voice), mode: musicMode(m.audio), duckDb: m.audio.duckDb };
  const voice = clips.filter((a) => a.bus === "voice");
  const music = clips.filter((a) => a.bus === "music");
  if (o.mode === "bed" && voice.length && music.length) {
    const [v, mu] = await Promise.all([busLoudness(voice, o, assets, dirname(out)), busLoudness(music, o, assets, dirname(out))]);
    if (v !== undefined && mu !== undefined) o.musicGainDb = bedGainDb(v, mu, m.audio.bedDb ?? BED_DB);
  }
  const tmp = `${out}.mix.wav`;
  const { inputs, graph } = mixGraph(clips, o);
  // Float wav: the sum may go over 0 dBFS before loudnorm brings it down.
  await ffmpeg([...inputs, "-filter_complex", graph, "-map", "[mix]", "-ac", "2", "-c:a", "pcm_f32le", tmp], {
    duration: dur,
    onProgress: (p) => onProgress?.(p * 0.6),
  });
  // Two-pass loudnorm: measure, then apply linearly. Aims under the -1.5 dBTP delivery ceiling:
  // the AAC encode adds up to ~0.15 dB of true peak (measured on the demo mixes).
  const t = m.audio.targetLufs;
  const measure = await ffmpeg(["-i", tmp, "-af", `loudnorm=I=${t}:TP=${LOUDNORM_TP}:LRA=11:print_format=json`, "-f", "null", "-"]);
  const json = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(measure.stderr)?.[0];
  let ln = `loudnorm=I=${t}:TP=${LOUDNORM_TP}:LRA=11`;
  if (json) {
    const j = JSON.parse(json) as Record<string, string>;
    if (Number.isFinite(Number(j.input_i)) && Number(j.input_i) > -70)
      ln += `:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  }
  await ffmpeg(["-i", tmp, "-af", `${ln},aresample=48000`, "-c:a", "aac", "-b:a", "192k", out], { duration: dur, onProgress: (p) => onProgress?.(0.6 + p * 0.4) });
  await Bun.$`rm -f ${tmp}`.quiet();
}

export const audibleDuration = (m: Montage) => Math.max(0, ...m.tracks.flatMap((t) => t.clips.map(clipEnd)));
