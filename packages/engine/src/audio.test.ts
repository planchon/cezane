import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asset, AudioSettings, Montage, musicMode, Project, type Track } from "@cezane/core";
import { audibleClips, audioKey, bedGainDb, busLoudness, busOf, ffValue, MICRO_FADE, mixAudio, mixGraph, type MixOptions, voiceChain } from "./audio";
import { probe } from "./probe";
import { ffmpeg, REPO_DIR } from "./proc";

const asset = (id: string, hash: string) =>
  Asset.parse({ id, kind: "audio", name: id, hash, file: `media/${hash}.wav`, hasAudio: true, provenance: { type: "import", path: id }, createdAt: "2026-11-16" });

const media = (id: string, assetId: string, start: number, duration: number, extra: Record<string, unknown> = {}) => ({ id, type: "media", assetId, start, duration, ...extra });

/** A-roll cut in three (two jump cuts) plus a split for a zoom, music under it, two SFX hits. */
function fixture(audio: Partial<AudioSettings> = {}, wav: (a: Asset) => string = (a) => `/w/${a.id}.wav`) {
  const montage = Montage.parse({
    id: "m",
    name: "m",
    settings: {},
    audio,
    tracks: [
      {
        id: "t_main",
        kind: "video",
        role: "main",
        name: "main",
        clips: [
          media("v1", "voice", 0, 30, { srcIn: 0 }),
          media("v2", "voice", 30, 30, { srcIn: 2 }), // jump cut: skips 1 s of source
          media("v3", "voice", 60, 15, { srcIn: 4 }), // jump cut
          media("v4", "voice", 75, 15, { srcIn: 4.5 }), // split of v3 (zoom): continuous
        ],
      },
      { id: "t_music", kind: "audio", role: "music", name: "music", clips: [media("mu", "music", 0, 90, { volume: 0.6 })] },
      { id: "t_sfx", kind: "audio", role: "sfx", name: "sfx", clips: [media("s1", "pop", 10, 6), media("s2", "pop", 64, 6)] },
    ],
  });
  const assets = new Map([asset("voice", "hv"), asset("music", "hm"), asset("pop", "hp")].map((a) => [a.id, a]));
  return { montage, assets, wav };
}

const opts = (m: Montage, extra: Partial<MixOptions> = {}): MixOptions => ({
  fps: m.settings.fps,
  total: 3,
  voice: voiceChain(m.audio.voice, "/models/bd.rnnn"),
  mode: musicMode(m.audio),
  duckDb: m.audio.duckDb,
  ...extra,
});

/** Labels of the clips (c<i>) that feed a filter line producing `[out]`. */
const feeding = (graph: string, out: string) => {
  const line = graph.split(";").find((l) => l.endsWith(`[${out}]`)) ?? "";
  return [...line.matchAll(/\[(c\d+)\]/g)].map((x) => x[1]);
};

describe("buses", () => {
  test("track roles map to buses", () => {
    const t = (kind: Track["kind"], role?: Track["role"]) => busOf({ kind, role });
    expect(t("audio", "sfx")).toBe("sfx");
    expect(t("audio", "music")).toBe("music");
    expect(t("audio")).toBe("music");
    expect(t("audio", "voice")).toBe("voice");
    expect(t("video", "main")).toBe("voice");
  });

  test("sfx are not in the voice bus nor in the sidechain key", () => {
    const { montage, assets, wav } = fixture({ duck: "sidechain", voice: "clean" });
    const clips = audibleClips(montage, assets, wav);
    const sfx = clips.flatMap((a, i) => (a.bus === "sfx" ? [`c${i}`] : []));
    const voice = clips.flatMap((a, i) => (a.bus === "voice" ? [`c${i}`] : []));
    expect(sfx).toHaveLength(2);
    const { graph } = mixGraph(clips, opts(montage));
    expect(feeding(graph, "vraw")).toEqual(voice);
    expect(feeding(graph, "sfx")).toEqual(sfx);
    // The sidechain key is a split of [voice], which only comes from [vraw].
    expect(graph).toContain("[voice]asplit=2[vmix][vkey]");
    expect(graph).toContain("[vkey]apad[vpad]"); // the music outlives the voice
    expect(graph).toContain("[mraw][vpad]sidechaincompress");
    expect(graph.split(";").filter((l) => l.includes("[voice]") && !l.startsWith("[voice]"))).toEqual([expect.stringMatching(/^\[vraw\]/)]);
    // SFX join after the ducking, before the end of the graph (loudnorm runs on [mix]).
    expect(graph).toMatch(/\[vmix\]\[music\]\[sfx\]amix=inputs=3:normalize=0,apad,atrim=duration=3\.000,aresample=48000\[mix\]$/);
  });

  test("sfx skip the voice chain", () => {
    const { montage, assets, wav } = fixture({ voice: "podcast" });
    const { graph } = mixGraph(audibleClips(montage, assets, wav), opts(montage));
    const chainLines = graph.split(";").filter((l) => l.includes("arnndn"));
    expect(chainLines).toHaveLength(1);
    expect(chainLines[0]).toStartWith("[vraw]");
    expect(graph).toContain("[c5][c6]amix=inputs=2:normalize=0:dropout_transition=0[sfx]");
  });
});

describe("micro-fades", () => {
  const { montage, assets, wav } = fixture();
  const clips = audibleClips(montage, assets, wav);
  const by = (id: string) => clips.find((a) => a.clip.id === id)!;

  test("every jump cut fades out and in", () => {
    expect(by("v1")).toMatchObject({ fadeIn: MICRO_FADE, fadeOut: MICRO_FADE });
    expect(by("v2")).toMatchObject({ fadeIn: MICRO_FADE, fadeOut: MICRO_FADE });
    expect(by("v3").fadeIn).toBe(MICRO_FADE);
    const { graph } = mixGraph(clips, opts(montage));
    // v2 lasts 1 s: fade in at 0, fade out over its last 8 ms.
    expect(graph).toContain("[1:a]atrim=start=2.000:duration=1.000,asetpts=PTS-STARTPTS,volume=1,afade=t=in:st=0:d=0.008,afade=t=out:st=0.992:d=0.008,adelay=1000|1000,asetpts=N/SR/TB[c1]");
  });

  test("a split that keeps the source running gets no fade", () => {
    expect(by("v3").fadeOut).toBe(0);
    expect(by("v4")).toMatchObject({ fadeIn: 0, fadeOut: MICRO_FADE });
  });

  test("explicit fades win, sfx keep their attack", () => {
    const m = structuredClone(montage);
    const v2 = m.tracks[0]!.clips[1]!;
    if (v2.type === "media") (v2.fadeIn = 6), (v2.fadeOut = 3);
    const c = audibleClips(m, assets, wav);
    expect(c.find((a) => a.clip.id === "v2")).toMatchObject({ fadeIn: 0.2, fadeOut: 0.1 });
    expect(by("s1")).toMatchObject({ fadeIn: 0, fadeOut: MICRO_FADE });
  });
});

describe("music bed", () => {
  test("gain puts the music bedDb under the voice", () => {
    expect(bedGainDb(-16, -10)).toBe(-21); // voice -16, bed at -31, music measured at -10
    expect(bedGainDb(-16, -40, 15)).toBe(9);
    expect(bedGainDb(-20, -20, 12)).toBe(-12);
    expect(bedGainDb(-20, -20, -12)).toBe(-12); // sign of bedDb does not matter
    expect(bedGainDb(-14, 0)).toBe(-29);
    expect(bedGainDb(-14, -69)).toBe(20); // clamped
  });

  test("bed mode applies the gain on the music bus, no sidechain", () => {
    const { montage, assets, wav } = fixture();
    expect(musicMode(montage.audio)).toBe("bed");
    const { graph } = mixGraph(audibleClips(montage, assets, wav), opts(montage, { musicGainDb: -21 }));
    expect(graph).toContain("[mraw]volume=-21.00dB[music]");
    expect(graph).not.toContain("sidechaincompress");
    expect(graph).toContain("[voice][music][sfx]amix=inputs=3");
  });

  test("off leaves the music at its clip volumes", () => {
    const { montage, assets, wav } = fixture({ duck: false });
    const { graph } = mixGraph(audibleClips(montage, assets, wav), opts(montage, { musicGainDb: -21 }));
    expect(graph).toContain("[mraw]anull[music]");
  });
});

describe("voice chain", () => {
  test("arnndn with its latency trimmed, afftdn without the model", () => {
    const rnn = voiceChain("clean", "/models/bd.rnnn");
    expect(rnn.filter).toContain("arnndn=m=/models/bd.rnnn:mix=0.85");
    expect(rnn.latency).toBe(480);
    const fft = voiceChain("clean", null);
    expect(fft.filter).toContain("afftdn=nf=-28:tn=1");
    expect(fft.latency).toBe(1200);
    expect(voiceChain("none")).toEqual({ filter: "anull", latency: 0 });
    const { montage, assets, wav } = fixture({ voice: "clean" });
    expect(mixGraph(audibleClips(montage, assets, wav), opts(montage)).graph).toContain(
      `[vraw]apad=pad_len=480,${rnn.filter},atrim=start_sample=480,asetpts=PTS-STARTPTS[voice]`,
    );
  });

  test("the shipped model is found", () => {
    expect(voiceChain("clean").filter).toContain(ffValue(join(REPO_DIR, "assets/rnnoise/bd.rnnn")));
  });

  test("filter values are escaped for the graph", () => {
    expect(ffValue("/a b/x.rnnn")).toBe("/a b/x.rnnn");
    expect(ffValue("/C:/it's,[1].rnnn")).toBe("/C\\\\:/it\\\\\\'s\\,\\[1\\].rnnn");
  });
});

describe("project files", () => {
  test("old boolean duck still parses", () => {
    expect(AudioSettings.parse({ targetLufs: -14, voice: "clean", duck: true, duckDb: -12 }).duck).toBe("bed");
    expect(AudioSettings.parse({ duck: false }).duck).toBe(false);
    expect(musicMode(AudioSettings.parse({ duck: false }))).toBe("off");
    expect(AudioSettings.parse({}).duck).toBe("bed");
    expect(() => AudioSettings.parse({ duck: "pump" })).toThrow();
  });

  test("demo projects load", async () => {
    for (const d of ["cezane-demo", "dax", "rewind"]) {
      const dir = join(REPO_DIR, "demo", d);
      Project.parse(await Bun.file(join(dir, "cezane.json")).json());
      for (const f of readdirSync(join(dir, "montages"))) {
        const m = Montage.parse(await Bun.file(join(dir, "montages", f)).json());
        expect(musicMode(m.audio)).toBe("bed");
      }
    }
  });

  test("true and bed share the audio cache key", () => {
    const a = fixture({ duck: true });
    const b = fixture({ duck: "bed" });
    const c = fixture({ duck: "sidechain" });
    expect(audioKey(a.montage, a.assets, a.wav)).toBe(audioKey(b.montage, b.assets, b.wav));
    expect(audioKey(a.montage, a.assets, a.wav)).not.toBe(audioKey(c.montage, c.assets, c.wav));
  });
});

describe("ffmpeg", () => {
  const dir = mkdtempSync(join(tmpdir(), "cezane-audio-"));
  const gen = (name: string, src: string, d: number) =>
    ffmpeg(["-f", "lavfi", "-t", String(d), "-i", src, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", join(dir, `${name}.wav`)]);
  beforeAll(async () => {
    // Voice: a 220 Hz buzz in syllables; music: a steady chord; sfx: a short pop.
    await gen("voice", "aevalsrc=0.4*sin(2*PI*220*t)*sin(2*PI*1100*t)*lt(mod(t\\,0.5)\\,0.35):s=48000", 6);
    await gen("music", "aevalsrc=0.5*sin(2*PI*330*t)+0.4*sin(2*PI*495*t):s=48000", 8);
    await gen("pop", "aevalsrc=0.9*sin(2*PI*(1400-6000*t)*t)*exp(-30*t):s=48000", 0.2);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const measure = async (file: string) => {
    const r = await ffmpeg(["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
    const s = r.stderr.split("Summary:").at(-1)!;
    return { i: Number(/I:\s+(-?[\d.]+) LUFS/.exec(s)![1]), tp: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(s)![1]) };
  };

  test(
    "bed mix renders at the target, music bedDb under the voice",
    async () => {
      const { montage, assets } = fixture({ voice: "clean" });
      const wav = (a: Asset) => join(dir, `${a.id}.wav`);
      const out = join(dir, "mix.m4a");
      await mixAudio(montage, assets, wav, out);
      expect(existsSync(out)).toBe(true);
      const { i, tp } = await measure(out);
      expect(Math.abs(i - -14)).toBeLessThan(1);
      expect(tp).toBeLessThanOrEqual(-1.5);
      // Music bus at the bed gain sits 15 dB under the voice bus.
      const clips = audibleClips(montage, assets, wav);
      const o = opts(montage, { voice: voiceChain("clean") });
      const v = await busLoudness(clips.filter((a) => a.bus === "voice"), o, assets, dir);
      const mu = await busLoudness(clips.filter((a) => a.bus === "music"), o, assets, dir);
      const g = bedGainDb(v!, mu!);
      const { inputs, graph } = mixGraph(clips.filter((a) => a.bus === "music"), { ...o, mode: "bed", musicGainDb: g });
      await ffmpeg([...inputs, "-filter_complex", graph, "-map", "[mix]", "-c:a", "pcm_f32le", join(dir, "bed.wav")]);
      expect(Math.abs((await measure(join(dir, "bed.wav"))).i - (v! - 15))).toBeLessThan(0.5);
    },
    60_000,
  );

  test(
    "a voice that starts late keeps the mix length and sound",
    async () => {
      // Music from 0, voice from 3 s, a pop at 1 s: adelay's untimed silence used to end the mix early.
      const montage = Montage.parse({
        id: "m",
        name: "m",
        settings: {},
        audio: { voice: "clean" },
        tracks: [
          { id: "t_main", kind: "video", role: "main", name: "main", clips: [media("v", "voice", 90, 120, { srcIn: 1.3 })] },
          { id: "t_music", kind: "audio", role: "music", name: "music", clips: [media("mu", "music", 0, 240)] },
          { id: "t_sfx", kind: "audio", role: "sfx", name: "sfx", clips: [media("s", "pop", 30, 6)] },
        ],
      });
      const out = join(dir, "late.m4a");
      await mixAudio(montage, fixture().assets, (a) => join(dir, `${a.id}.wav`), out);
      expect(Math.abs((await probe(out)).duration! - 8)).toBeLessThan(0.05); // 240 frames
      expect(Math.abs((await measure(out)).i - -14)).toBeLessThan(1);
    },
    60_000,
  );

  test(
    "sidechain mix renders",
    async () => {
      const { montage, assets } = fixture({ voice: "podcast", duck: "sidechain" });
      const out = join(dir, "sc.m4a");
      await mixAudio(montage, assets, (a) => join(dir, `${a.id}.wav`), out);
      expect(Math.abs((await measure(out)).i - -14)).toBeLessThan(1);
    },
    60_000,
  );
});
