import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Analysis, Asset, Derived, Transcript } from "@cezane/core";
import { cacheDir, ffmpeg, FFMPEG, MODELS_DIR, run, runOk } from "./proc";
import { type Probe, probe } from "./probe";

const WHISPER = Bun.which("whisper-cli") ?? "/opt/homebrew/bin/whisper-cli";
const WHISPER_MODEL = join(MODELS_DIR, "ggml-large-v3-turbo-q5_0.bin");

/** Long side cap of normalized videos: room to zoom into a 1080x1920 frame. */
const MAX_LONG_SIDE = 2560;

type Step = { name: keyof Derived | "transcript"; weight: number };

/**
 * Computes everything that only depends on the source file, once, in the global cache.
 * Each step is skipped when its output already exists (same file in two projects = done once).
 */
export async function ingest(
  asset: Asset,
  sourcePath: string,
  info: Probe,
  onProgress: (p: number, label: string) => void,
  opts: { transcribe?: boolean } = {},
): Promise<Partial<Asset>> {
  const dir = cacheDir(asset.hash);
  const derived: Derived = {};
  const out = (f: string) => join(dir, f);
  const have = (f: string) => existsSync(out(f));
  const steps: Step[] = [];
  let done = 0;
  const total = () => steps.reduce((s, x) => s + x.weight, 0) || 1;
  const progress = (label: string, p = 0) => onProgress(Math.min(0.99, (done + p) / total()), label);

  if (asset.kind === "image") {
    steps.push({ name: "normalized", weight: 1 });
    if (!have("image.png")) await ffmpeg(["-i", sourcePath, "-frames:v", "1", "-vf", `scale='min(${MAX_LONG_SIDE},iw)':-2`, out("image.png")]);
    if (!have("poster.jpg")) await ffmpeg(["-i", out("image.png"), "-vf", "scale=-2:480", "-q:v", "4", out("poster.jpg")]);
    return { derived: { normalized: "image.png", poster: "poster.jpg" }, status: "ready" };
  }

  let duration = info.duration ?? 0;
  const patch: Partial<Asset> = {};
  if (asset.kind === "video") steps.push({ name: "normalized", weight: 3 }, { name: "thumbs", weight: 0.5 });
  if (info.hasAudio) steps.push({ name: "audio", weight: 0.5 }, { name: "analysis", weight: 0.5 }, { name: "waveform", weight: 0.2 });
  const transcribe = info.hasAudio && (opts.transcribe ?? asset.kind === "video");
  if (transcribe) steps.push({ name: "transcript", weight: 2 });

  if (asset.kind === "video") {
    progress("normalisation");
    if (!have("normalized.mp4")) {
      const w = info.width ?? 1920;
      const h = info.height ?? 1080;
      const scale = Math.max(w, h) > MAX_LONG_SIDE ? (w >= h ? `scale=${MAX_LONG_SIDE}:-2` : `scale=-2:${MAX_LONG_SIDE}`) : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
      // H.264 (Remotion cannot decode HEVC headless), constant 30 fps, rotation applied, keyframe every 0.5 s.
      await ffmpeg(
        ["-i", sourcePath, "-map", "0:v:0", "-vf", `${scale},fps=30,format=yuv420p`, "-c:v", "h264_videotoolbox", "-b:v", "14M", "-g", "15", "-an", "-movflags", "+faststart", out("normalized.tmp.mp4")],
        { duration, onProgress: (p) => progress("normalisation", p * 3) },
      );
      await Bun.write(out("normalized.mp4"), Bun.file(out("normalized.tmp.mp4")));
      await Bun.$`rm -f ${out("normalized.tmp.mp4")}`.quiet();
    }
    derived.normalized = "normalized.mp4";
    // Screencasts (WebM) carry no duration in their container: read it from the normalized file.
    if (!info.duration) {
      duration = (await probe(out("normalized.mp4"))).duration ?? 0;
      patch.duration = duration;
    }
    done += 3;
    progress("vignettes");
    if (!have("thumbs.jpg")) {
      const fps = Math.max(0.01, 10 / Math.max(duration, 1));
      await ffmpeg(["-i", out("normalized.mp4"), "-vf", `fps=${fps},scale=-2:160,tile=10x1`, "-frames:v", "1", "-q:v", "5", out("thumbs.jpg")]);
    }
    if (!have("poster.jpg")) await ffmpeg(["-ss", String(Math.min(1, duration / 3)), "-i", out("normalized.mp4"), "-frames:v", "1", "-vf", "scale=-2:480", "-q:v", "4", out("poster.jpg")]);
    derived.thumbs = "thumbs.jpg";
    derived.poster = "poster.jpg";
    done += 0.5;
  }

  if (info.hasAudio) {
    progress("audio");
    if (!have("audio.wav")) await ffmpeg(["-i", sourcePath, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", out("audio.wav")], { duration });
    derived.audio = "audio.wav";
    done += 0.5;
    progress("analyse");
    if (!have("analysis.json")) await Bun.write(out("analysis.json"), JSON.stringify(await analyze(out("audio.wav"), asset.kind === "video" ? out("normalized.mp4") : undefined)));
    derived.analysis = "analysis.json";
    done += 0.5;
    if (!have("waveform.json")) await Bun.write(out("waveform.json"), JSON.stringify(await waveform(out("audio.wav"), duration)));
    derived.waveform = "waveform.json";
    done += 0.2;
  }

  if (transcribe) {
    progress("transcription");
    if (!have("transcript.v2.json")) await Bun.write(out("transcript.v2.json"), JSON.stringify(await transcribeFile(out("audio.wav"), dir)));
    derived.transcript = "transcript.v2.json";
    done += 2;
  }
  return { ...patch, derived, status: "ready" };
}

/** Silences, scene changes and integrated loudness, from ffmpeg filters. */
export async function analyze(wav: string, video?: string): Promise<Analysis> {
  const a = await run([FFMPEG, "-hide_banner", "-nostats", "-i", wav, "-af", "silencedetect=noise=-35dB:d=0.3,ebur128", "-f", "null", "-"]);
  const silences: Analysis["silences"] = [];
  let open: number | undefined;
  for (const line of a.stderr.split("\n")) {
    const s = /silence_start: ([\d.]+)/.exec(line);
    if (s) open = Number(s[1]);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && open !== undefined) {
      silences.push({ start: open, end: Number(e[1]) });
      open = undefined;
    }
  }
  const lufs = /I:\s+(-?[\d.]+) LUFS/.exec(a.stderr.split("Summary:").at(-1) ?? "");
  const scenes: number[] = [];
  if (video) {
    const v = await run([FFMPEG, "-hide_banner", "-nostats", "-i", video, "-vf", "scale=160:-2,select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"]);
    for (const m of v.stderr.matchAll(/pts_time:([\d.]+)/g)) scenes.push(Number(m[1]));
  }
  return { silences, scenes, loudness: lufs ? Number(lufs[1]) : undefined };
}

/** Peak envelope, 20 values per second, 0..1. */
async function waveform(wav: string, duration: number): Promise<number[]> {
  const r = Bun.spawn([FFMPEG, "-hide_banner", "-i", wav, "-ac", "1", "-ar", "2000", "-f", "f32le", "-"], { stdout: "pipe", stderr: "ignore" });
  const buf = await new Response(r.stdout).arrayBuffer();
  const samples = new Float32Array(buf);
  const per = 100; // 2000 Hz / 20 per second
  const peaks: number[] = [];
  for (let i = 0; i < samples.length; i += per) {
    let m = 0;
    for (let j = i; j < Math.min(i + per, samples.length); j++) m = Math.max(m, Math.abs(samples[j]!));
    peaks.push(+m.toFixed(3));
  }
  void duration;
  return peaks;
}

type WhisperJson = {
  result?: { language?: string };
  transcription: { offsets: { from: number; to: number }; text: string }[];
};

/** Word-level transcript with whisper.cpp on the GPU (one segment per word). */
export async function transcribeFile(wav: string, workDir: string): Promise<Transcript> {
  if (!existsSync(WHISPER_MODEL)) throw new Error(`whisper model missing: ${WHISPER_MODEL}`);
  const w16 = join(workDir, "whisper16k.wav");
  await ffmpeg(["-i", wav, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", w16]);
  const base = join(workDir, "whisper");
  await runOk([WHISPER, "-m", WHISPER_MODEL, "-f", w16, "-l", "auto", "-ml", "1", "-sow", "-oj", "-of", base, "-np", "--dtw", "large.v3.turbo", "-mc", "0", "-sns"]);
  const j = (await Bun.file(`${base}.json`).json()) as WhisperJson;
  await Bun.$`rm -f ${w16} ${base}.json`.quiet();
  const words: Transcript["words"] = [];
  for (const seg of j.transcription) {
    const text = seg.text.trim();
    if (!text || /^\[.*\]$/.test(text)) continue;
    const start = seg.offsets.from / 1000;
    const end = Math.max(start + 0.05, seg.offsets.to / 1000);
    // whisper sometimes splits punctuation into its own segment: glue it to the previous word.
    if (/^[.,!?;:…]+$/.test(text) && words.length) {
      words[words.length - 1]!.text += text;
      continue;
    }
    words.push({ text, start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return { language: j.result?.language ?? "auto", words };
}
