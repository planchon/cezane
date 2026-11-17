import type { ProjectFile } from "@cezane/core";
import { FileX2, Images, Loader2, Palette, Plus, SquareArrowOutUpRight } from "lucide-react";
import { useState } from "react";
import { assetMedia } from "../api";
import { ClaudePanel } from "../panels/RightPanel";
import { useApp } from "../store";
import { renderVersion } from "../ui/actions";
import { relTime } from "../ui/format";
import { Resizer, usePanelSize } from "../ui/Resizer";
import { useMedias } from "./context";
import { addToMontage, duration, formatCost, formatSize, reveal } from "./files";
import { cleanPrompt } from "../canvas/generation";
import "./medias.css";

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
const baseName = (path: string) => path.split("/").at(-1) ?? path;
const providerName: Record<string, string> = { codex: "Codex", claude: "Claude", fal: "FAL" };

type PanelView = "canvas" | "medias";

/** Right column of the Canvas and Médias tabs: the selected file ("Fichier") and Claude's activity. */
export function FilePanel({ view }: { view: PanelView }) {
  const { ui, log } = useApp();
  const panel = usePanelSize("right", 300, 240, 480);
  const [tab, setTab] = useState<"file" | "claude">(ui.panel === "claude" ? "claude" : "file");
  const answered = new Set(log.filter((e) => e.kind === "permission_done").map((e) => e.permissionId));
  const waiting = log.some((e) => e.kind === "permission" && !answered.has(e.permissionId));
  return (
    <aside className="R" style={{ width: panel.size }}>
      <Resizer edge="left" panel={panel} />
      <Head onClaude={() => setTab("claude")} />
      <div className="tabs">
        <button className={`tab ${tab === "file" ? "on" : ""}`} onClick={() => setTab("file")}>
          Fichier
        </button>
        <button className={`tab ${tab === "claude" ? "on" : ""}`} onClick={() => setTab("claude")}>
          Claude {waiting && <span className="alert" />}
        </button>
      </div>
      {tab === "file" ? <FileInfo view={view} /> : <ClaudePanel />}
    </aside>
  );
}

/** Avatars (you, Claude) and Rendre, as in the other views. */
function Head({ onClaude }: { onClaude: () => void }) {
  const { state, connected } = useApp();
  const claude = state?.claude;
  const rendering = state?.versions.some((v) => v.status === "rendering");
  return (
    <div className="rh">
      <div className="sp" />
      <div className="avs">
        <span className="av me" title="Toi">
          P
        </span>
        <button
          className={`av cl ${claude?.running ? "busy" : ""}`}
          style={!connected ? { background: "var(--text-3)" } : undefined}
          onClick={onClaude}
          title={!connected ? "Serveur injoignable" : claude?.running ? `Claude travaille · ${claude.task ?? ""}` : "Claude est disponible"}
        >
          C
        </button>
      </div>
      <button className="btn pri" disabled={!state || rendering} onClick={() => void renderVersion()} title="Rendre une nouvelle version du montage">
        {rendering && <Loader2 size={12} className="spin" />}
        Rendre
      </button>
    </div>
  );
}

function FileInfo({ view }: { view: PanelView }) {
  const m = useMedias();
  const sel = m.selected;
  if (sel?.startsWith("missing:")) return <MissingInfo assetId={sel.slice(8)} />;
  const f = sel ? m.byPath.get(sel) : undefined;
  if (!f)
    return (
      <div className="empty" style={{ paddingTop: 12 }}>
        {view === "canvas" ? "Sélectionne un résultat ou une référence sur le canvas." : "Sélectionne un fichier."}
      </div>
    );
  return <FileDetails f={f} view={view} />;
}

function Preview({ f }: { f: ProjectFile }) {
  const { state } = useApp();
  const asset = f.assetId ? state?.project.assets.find((a) => a.id === f.assetId) : undefined;
  if (f.kind === "video") {
    const src = asset?.status === "ready" ? assetMedia(asset) : f.url;
    return <video key={f.path} className="md-pv" src={src} poster={f.posterUrl ?? f.thumbUrl} controls muted playsInline />;
  }
  if (f.kind === "audio") return <audio key={f.path} src={f.url} controls style={{ width: "100%" }} />;
  if (f.thumbUrl) return <img className="md-pv" src={f.thumbUrl} alt="" />;
  return <div className="md-pv ph" />;
}

function FileDetails({ f, view }: { f: ProjectFile; view: PanelView }) {
  const { state } = useApp();
  const m = useMedias();
  const asset = f.assetId ? state?.project.assets.find((a) => a.id === f.assetId) : undefined;
  const g = f.generated;
  const dims = f.width && f.height ? `${f.width} × ${f.height}` : undefined;
  const size = [dims, formatSize(f.size), f.duration !== undefined && f.kind !== "image" ? duration(f.duration) : undefined].filter(Boolean).join(" · ");
  const by = g
    ? `par ${providerName[g.provider] ?? g.provider}`
    : f.capture
      ? f.capture.source === "ios"
        ? "capture du simulateur"
        : f.capture.source === "web"
          ? "capture web"
          : "déposé dans Captures"
      : f.version
        ? `rendu V${f.version.n}`
        : f.provenance?.type === "import"
          ? "importé"
          : undefined;
  const montages = state?.project.montages ?? [];
  const used = (f.usedIn ?? []).map((id) => montages.find((x) => x.id === id)?.name ?? id);
  const canAdd = Boolean(asset && asset.status === "ready" && f.folder !== "Exports" && state?.montage);
  // Images and videos can be a generation's reference.
  const canRef = Boolean(asset && asset.status !== "error" && (f.kind === "image" || f.kind === "video"));

  return (
    <div className="rp-body scroll md-info">
      <div className="md-pvw">
        <Preview f={f} />
      </div>
      <div className="sec">
        <div className="sh md-name">
          <span className="ell">{f.name}</span>
        </div>
        <div className="pad md-kv">
          <span className="c2">Dossier</span>
          <span className="ell">{dirOf(f.path)}</span>
          <span className="c2">Taille</span>
          <span>{size}</span>
          <span className="c2">Créé</span>
          <span>
            {relTime(f.createdAt)}
            {by ? `, ${by}` : ""}
          </span>
          {g && g.cost !== undefined && g.cost > 0 && (
            <>
              <span className="c2">Coût</span>
              <span>{formatCost(g.cost)}</span>
            </>
          )}
          {f.capture?.source === "web" && (
            <>
              <span className="c2">Page</span>
              <span className="ell" title={f.capture.target}>
                {f.capture.target}
              </span>
            </>
          )}
          {used.length > 0 && (
            <>
              <span className="c2">Montage</span>
              <span>{used.join(", ")}</span>
            </>
          )}
          {f.status === "ingesting" && (
            <>
              <span className="c2">État</span>
              <span>import en cours</span>
            </>
          )}
          {f.status === "error" && (
            <>
              <span className="c2">État</span>
              <span className="md-miss">{f.error ?? "erreur"}</span>
            </>
          )}
          {f.duplicateOf && (
            <>
              <span className="c2">Doublon</span>
              <span>même contenu qu'un fichier déjà importé</span>
            </>
          )}
        </div>
      </div>
      {g && (
        <div className="sec">
          <div className="sh">Prompt</div>
          <div className="pad">
            <div className="md-ta">{cleanPrompt(g.prompt)}</div>
            {g.references.length > 0 && (
              <div className="md-refl">
                <span className="c2">Références</span>
                {g.references.map((r) => (
                  <button key={r.assetId} className="bd" onClick={() => r.path && m.selectAsset(r.assetId)} title={r.path}>
                    {r.name ?? r.path ?? r.assetId}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {f.version?.summary && (
        <div className="sec">
          <div className="sh">Version V{f.version.n}</div>
          <div className="pad">
            <div className="md-ta">{f.version.summary}</div>
          </div>
        </div>
      )}
      <div className="sec last">
        <div className="pad md-acts">
          <button className="btn lg" onClick={() => void reveal({ path: f.path })}>
            <SquareArrowOutUpRight size={16} />
            Afficher dans le Finder
          </button>
          {canAdd && (
            <button className="btn lg" onClick={() => void addToMontage(asset!, state!.montage)} title="Ajoute le fichier au montage, à la position de la tête de lecture">
              <Plus size={16} />
              Ajouter au montage
            </button>
          )}
          {view === "medias" && canRef && (
            <button className="btn lg" onClick={() => m.toCanvas([asset!.id])} title="Pose le fichier sur le canvas et s'en sert comme référence de la prochaine génération">
              <Palette size={16} />
              Utiliser sur le canvas
            </button>
          )}
          {view === "canvas" && (
            <button className="btn lg" onClick={() => m.showInMedias(f.path)} title={`Ouvre ${dirOf(f.path)}/ dans l'onglet Médias`}>
              <Images size={16} />
              Voir dans Médias
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MissingInfo({ assetId }: { assetId: string }) {
  const { state } = useApp();
  const m = useMedias();
  const x = m.listing?.missing.find((y) => y.assetId === assetId);
  if (!x) return <div className="empty" style={{ paddingTop: 12 }}>Fichier introuvable.</div>;
  const montages = state?.project.montages ?? [];
  const used = x.usedIn.map((id) => montages.find((y) => y.id === id)?.name ?? id);
  // A render failed for it: its cache is gone too, the reel cannot render without it.
  const blocked = state?.versions.find((v) => v.status === "error" && v.failure?.kind === "missing" && v.failure.assetIds?.includes(assetId));
  return (
    <div className="rp-body scroll md-info">
      <div className="md-pvw">
        <div className="md-pv ph miss">
          <FileX2 size={16} />
        </div>
      </div>
      <div className="sec">
        <div className="sh md-name">
          <span className="ell">{baseName(x.path)}</span>
        </div>
        <div className="pad md-kv">
          <span className="c2">Dossier</span>
          <span className="ell">{dirOf(x.path)}</span>
          <span className="c2">État</span>
          <span className="md-miss">supprimé du Finder</span>
          {used.length > 0 && (
            <>
              <span className="c2">Montage</span>
              <span>{used.join(", ")}</span>
            </>
          )}
        </div>
      </div>
      <div className="sec last">
        <div className="pad c2" style={{ paddingTop: 12 }}>
          {blocked ? `Son cache a disparu aussi : V${blocked.n} n'a pas pu être rendue sans lui.` : "Les rendus continuent depuis le cache."} Remets le fichier dans {dirOf(x.path)}/ (ou sors-le de la Corbeille) : Cezane le retrouve tout seul.
        </div>
      </div>
    </div>
  );
}
