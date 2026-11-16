import type { Version } from "@cezane/core";
import { CircleAlert, CircleCheck, Clapperboard, Download, Folder, Loader2, Play, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileUrl } from "../api";
import { playhead, useApp, useVersionMontage } from "../store";
import { renderVersion } from "../ui/actions";
import { clockShort, relTime } from "../ui/format";
import { VersionPicker } from "../ui/Pickers";
import { FailureCard } from "../ui/RenderFailure";
import { toast } from "../ui/toast";

const ZONES_KEY = "cezane.export.tiktokZones";
const PREVIEW_H = 533; // 300 px wide for 9:16, as in the mockup

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    // storage unavailable: the toggle isn't remembered
  }
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "cezane";

/** Export: the 9:16 preview with the TikTok interface zones, and the render/download card. */
export function ExportView() {
  const { state, version } = useApp();
  const montage = useVersionMontage(version, state?.montage);
  const dims = montage?.settings ?? state?.montage.settings ?? { width: 1080, height: 1920, fps: 30 };
  const aspect = dims.width / dims.height;
  const vertical = Math.abs(aspect - 9 / 16) < 0.02;
  const [zones, setZones] = useState(() => loadFlag(ZONES_KEY, true));
  const w = Math.round(Math.min(PREVIEW_H * aspect, 480));
  const h = Math.round(w / aspect);

  return (
    <div className="cv export scroll">
      <div className="ex">
        <div className="ex-prev">
          <Preview version={version} w={w} h={h} zones={vertical && zones} />
          {vertical && (
            <button
              className="tgl"
              role="switch"
              aria-checked={zones}
              onClick={() => {
                setZones(!zones);
                saveFlag(ZONES_KEY, !zones);
              }}
            >
              <span className={`tg ${zones ? "on" : ""}`} />
              Zones de l'interface TikTok
            </button>
          )}
        </div>
        <ExportCard version={version} dims={dims} />
      </div>
    </div>
  );
}

function Preview({ version, w, h, zones }: { version?: Version; w: number; h: number; zones: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const file = version?.status === "ready" ? version.file : undefined;

  // Space plays/pauses the preview (the montage view's transport keys are not mounted here).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || (e.target as HTMLElement).closest("input, textarea, select, button") || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <div className="fr ex-fr" style={{ width: w, height: h }}>
      {file ? (
        <>
          <video
            ref={video}
            src={fileUrl(file)}
            playsInline
            preload="auto"
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            // Open on the frame the timeline was showing.
            onLoadedMetadata={(e) => {
              const f = playhead.get();
              if (f > 0 && version) e.currentTarget.currentTime = Math.min(e.currentTarget.duration, (f + 0.5) / version.fps);
            }}
          />
          {!playing && (
            <button className="ex-play" onClick={toggle} title="Lire (espace)">
              <Play size={16} />
            </button>
          )}
        </>
      ) : (
        <div className="ex-empty">
          {version?.status === "rendering" ? `Rendu de V${version.n}… ${Math.round(version.progress * 100)} %` : version?.status === "error" ? `V${version.n} n'a pas pu être rendue` : "Pas encore de version rendue"}
        </div>
      )}
      {zones && (
        <div className="safe" aria-hidden="true">
          <i className="z-top" />
          <i className="z-bottom" />
          <i className="z-right" />
        </div>
      )}
    </div>
  );
}

function ExportCard({ version, dims }: { version?: Version; dims: { width: number; height: number; fps: number } }) {
  const { state } = useApp();
  const rendering = state?.versions.find((v) => v.status === "rendering");
  const ready = version?.status === "ready" && version.file ? version : undefined;
  const size = useFileSize(ready?.file);
  const name = ready ? `${slug(state?.montage.name || state?.project.name || "cezane")}-v${ready.n}.mp4` : "";

  const facts = !version
    ? "Aucune version rendue pour ce montage."
    : version.status === "rendering"
      ? `Rendu en cours · ${Math.round(version.progress * 100)} %`
      : version.status === "error"
        ? `Rendu échoué ${relTime(version.createdAt)}`
        : [
            `Rendue ${relTime(version.createdAt)}`,
            clockShort(version.durationFrames, version.fps),
            `${dims.width}×${dims.height}`,
            `${version.fps} i/s`,
            version.renderSeconds ? `en ${Math.round(version.renderSeconds)} s` : undefined,
          ]
            .filter(Boolean)
            .join(" · ");

  return (
    <div className="card13 ex-card">
      <div className="sec">
        <div className="sh">
          Version
          <span className="r">
            <VersionPicker align="right" empty="Aucune" />
          </span>
        </div>
        <div className="pad c2">{facts}</div>
        {version?.summary && <div className="pad ex-sum">{version.summary}</div>}
      </div>
      <div className="sec">
        <div className="sh">Rendu</div>
        <RenderStatus version={version} />
      </div>
      <div className="sec last">
        <div className="sh">Fichier</div>
        <div className="pad ex-file" title={ready && state ? `${state.dir}/${ready.file}` : undefined}>
          <Folder size={16} />
          <span className="ell">{ready?.file ?? "—"}</span>
          {size && <span className="c3">{size}</span>}
        </div>
        <div className="pad ex-acts">
          <button className="btn lg" disabled={!state || Boolean(rendering)} onClick={() => void renderVersion()} title="Rendre une nouvelle version du montage">
            {rendering ? <Loader2 size={16} className="spin" /> : <Clapperboard size={16} />}
            {rendering ? `Rendu de V${rendering.n}…` : "Rendre"}
          </button>
          {ready ? (
            <a className="btn pri lg" href={fileUrl(ready.file!)} download={name} onClick={() => toast(`${name} : téléchargement lancé`)} title={`Télécharger ${name}`}>
              <Download size={16} />
              Exporter le .mp4
            </a>
          ) : (
            <button className="btn pri lg" disabled>
              <Download size={16} />
              Exporter le .mp4
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Where the displayed version stands against the montage being edited. */
function RenderStatus({ version }: { version?: Version }) {
  const { state } = useApp();
  if (!version)
    return (
      <div className="pad ex-st">
        <CircleAlert size={16} className="c3" />
        Rien à exporter : clique sur « Rendre ».
      </div>
    );
  if (version.status === "rendering")
    return (
      <div className="pad">
        <div className="ex-st">
          <Loader2 size={16} className="spin" />
          Rendu de V{version.n} en cours
          <span className="c2 r">{Math.round(version.progress * 100)} %</span>
        </div>
        <div className="bar">
          <i style={{ width: `${Math.max(2, version.progress * 100)}%` }} />
        </div>
      </div>
    );
  // A failed render (the one shown, or a newer one): why, and what fixes it.
  const last = state?.versions.at(-1);
  const failed = version.status === "error" ? version : last?.status === "error" && last.n > version.n ? last : undefined;
  if (failed)
    return (
      <div className="pad">
        <FailureCard version={failed} kicker={failed !== version} />
      </div>
    );
  const newer = [...(state?.versions ?? [])].reverse().find((v) => v.n > version.n && v.status === "ready");
  const changed = state && state.revision !== version.revision;
  if (newer)
    return (
      <div className="pad ex-st">
        <TriangleAlert size={16} className="warn" />
        V{newer.n} est plus récente que cette version.
      </div>
    );
  if (changed)
    return (
      <div className="pad ex-st">
        <TriangleAlert size={16} className="warn" />
        Le montage a changé depuis ce rendu.
      </div>
    );
  return (
    <div className="pad ex-st">
      <CircleCheck size={16} className="ok" />À jour avec le montage.
    </div>
  );
}

/** "38,2 Mo" from a HEAD request on the file, once per file. */
function useFileSize(file?: string): string | undefined {
  const [size, setSize] = useState<string>();
  useEffect(() => {
    setSize(undefined);
    if (!file) return;
    let alive = true;
    fetch(fileUrl(file), { method: "HEAD" })
      .then((r) => {
        const n = Number(r.headers.get("content-length"));
        if (alive && r.ok && n > 0) setSize(`${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file]);
  return size;
}
