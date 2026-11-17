import type { Job, ProjectSummary, ReelSummary } from "@cezane/core";
import { Clapperboard, FolderOpen, Plus, Wrench } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useJobs, useProjects } from "../projects";
import { relTime } from "../ui/format";
import { newProject, newReel, openFolder, reelTitle } from "../ui/projectActions";
import { openSetup, SetupCard, useSetup } from "../ui/Setup";
import { ProjectIcon } from "../ui/TopBar";

/** Where a reel stands, from what the server knows (no "published": the server does not track it). */
type Stage = "claude" | "render" | "error" | "rushes" | "review" | "ready";
type Card = { project: ProjectSummary; reel: ReelSummary; stage: Stage; job?: Job; modifiedAt: string };
type Filter = "all" | "wip" | "ready";

const live = (j: Job) => j.status === "running" || j.status === "queued";

function stageOf(project: ProjectSummary, reel: ReelSummary, jobs: Job[]): Pick<Card, "stage" | "job"> {
  const mine = jobs.filter((j) => j.projectId === project.id && live(j));
  const render = mine.find((j) => j.kind === "render" && j.montageId === reel.id);
  // Claude on this reel: its render, else what it runs right now in the project (capture, generation…).
  if (reel.claude) return { stage: "claude", job: render ?? mine.find((j) => j.status === "running" && !j.montageId) };
  if (render || (reel.status === "rendering" && project.loaded)) return { stage: "render", job: render };
  if (reel.status === "error") return { stage: "error" };
  if (reel.status === "draft") return { stage: "rushes" };
  const c = reel.comments;
  if (c && c.open + c.toReview > 0) return { stage: "review" };
  return { stage: "ready" };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * The home tab ("Atelier"): every reel of every project, grouped by where it stands, like a Figma
 * file browser. The left column lists the projects (click: only its reels) and Claude's queue.
 */
export function Home() {
  const projects = useProjects();
  const list = projects.projects;
  const sched = useJobs(true);
  const jobs = sched?.jobs ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const [only, setOnly] = useState<string>();
  const focus = only ? list?.find((p) => p.id === only) : undefined;

  const cards = useMemo(() => {
    const out: Card[] = [];
    for (const p of list ?? []) {
      if (p.missing || (focus && p.id !== focus.id)) continue;
      for (const r of p.reels) out.push({ project: p, reel: r, ...stageOf(p, r, jobs), modifiedAt: r.modifiedAt ?? p.modifiedAt });
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }, [list, jobs, focus]);

  const wip = cards.filter((c) => c.stage !== "ready");
  const ready = cards.filter((c) => c.stage === "ready");
  const claude = cards.filter((c) => c.stage === "claude").length;
  const review = cards.filter((c) => c.stage === "review").length;
  const sentence = [
    claude ? `Claude monte ${plural(claude, "reel")}.` : "",
    review ? `${review} ${review > 1 ? "attendent" : "attend"} ta relecture.` : "",
  ].filter(Boolean);
  const visible = (list ?? []).filter((p) => !p.missing);
  const open = (c: Card) => void projects.open(c.project.id, { reel: c.reel.id, view: "timeline" });
  const setup = useSetup();

  return (
    <div className="atelier">
      <aside className="hm-side">
        <div className="hm-nav-top">
          <button className={`nav ${only ? "" : "on"}`} onClick={() => setOnly(undefined)}>
            <Clapperboard size={16} />
            Atelier
            <span className="r">{visible.reduce((n, p) => n + p.reels.length, 0)}</span>
          </button>
          <button className="nav" onClick={openSetup} title="Les outils dont Cezane a besoin : vérifier, installer">
            <Wrench size={16} />
            Préparer Cezane
            {setup.state && !setup.state.ready && <span className="r su-dot" aria-label="Il manque des éléments" />}
          </button>
        </div>
        <div className="sh light">
          Projets
          <span className="r">
            <button className="ib" title="Nouveau projet…" aria-label="Nouveau projet" onClick={() => void newProject(projects)}>
              <Plus size={16} />
            </button>
          </span>
        </div>
        <div className="hm-projects scroll">
          {(list ?? []).map((p) => (
            <button
              key={p.id}
              className={`nav ${only === p.id ? "on" : ""} ${p.missing ? "missing" : ""}`}
              title={p.missing ? `Dossier introuvable : ${p.path}` : `${p.path}\nDouble-clic : ouvrir`}
              onClick={() => setOnly(p.id)}
              onDoubleClick={() => !p.missing && void projects.open(p.id)}
            >
              <ProjectIcon id={p.id} project={p} />
              <span className="ell">{p.name}</span>
              {p.claudeRunning && <span className="cl-dot" />}
              <span className="r">{p.missing ? "introuvable" : p.reels.length}</span>
            </button>
          ))}
        </div>
        <ClaudeQueue jobs={jobs} projects={list ?? []} />
      </aside>

      <main className="hm-main">
        <div className="hm-bar">
          {(
            [
              ["all", "Tous", cards.length],
              ["wip", "En cours", wip.length],
              ["ready", "Prêts", ready.length],
            ] as const
          ).map(([id, label, n]) => (
            <button key={id} className={`hm-tab ${filter === id ? "on" : ""}`} onClick={() => setFilter(id)}>
              {label}
              {id !== "all" && <span className="c3">{n}</span>}
            </button>
          ))}
          <div className="sp" />
          <button className="btn" onClick={() => void openFolder(projects)}>
            <FolderOpen size={16} />
            Ouvrir un dossier
          </button>
          <button className="btn pri" onClick={() => void newProject(projects)}>
            <Plus size={16} />
            Nouveau projet
          </button>
        </div>

        <div className="hm-body scroll">
          <div className="hm-head">
            <div className="ell">
              <div className="t24 ell">{focus ? focus.name : "Atelier"}</div>
              <div className="c2 ell">
                {!list
                  ? projects.connected
                    ? "Chargement…"
                    : "Connexion au serveur Cezane…"
                  : sentence.length
                    ? sentence.join(" ")
                    : focus
                      ? `${plural(focus.reels.length, "reel")} · modifié ${relTime(focus.modifiedAt)} · ${focus.path}`
                      : `${plural(cards.length, "reel")} dans ${plural(visible.length, "projet")}.`}
              </div>
            </div>
            {focus && (
              <div className="hm-head-acts">
                <button
                  className="btn"
                  onClick={async () => {
                    const r = await newReel(focus.id);
                    if (r) void projects.open(focus.id, { reel: r.id, view: "timeline" });
                  }}
                >
                  <Plus size={16} />
                  Nouveau reel
                </button>
                <button className="btn" onClick={() => void projects.open(focus.id)}>
                  Ouvrir le projet
                </button>
              </div>
            )}
          </div>

          {!focus && <SetupCard setup={setup} />}

          {list && !visible.length && (
            <div className="hm-empty">
              <div className="t13 s">Aucun projet pour l'instant</div>
              <div className="c2">Crée un projet dans ~/Cezane/Projets, ou ouvre un dossier existant.</div>
            </div>
          )}

          {filter !== "ready" && wip.length > 0 && <Group title="En cours" cards={wip} focus={focus} onOpen={open} />}
          {filter !== "wip" && ready.length > 0 && <Group title="Prêts" cards={ready} focus={focus} onOpen={open} />}
          {list && visible.length > 0 && !(filter === "ready" ? ready : filter === "wip" ? wip : cards).length && <div className="hm-empty c2">Rien ici pour l'instant.</div>}
        </div>
      </main>
    </div>
  );
}

function Group({ title, cards, focus, onOpen }: { title: string; cards: Card[]; focus?: ProjectSummary; onOpen: (c: Card) => void }) {
  return (
    <section>
      <div className="s hm-gt">{title}</div>
      <div className="hm-grid">
        {cards.map((c) => (
          <ReelCard key={`${c.project.id}/${c.reel.id}`} card={c} showProject={!focus} onOpen={() => onOpen(c)} />
        ))}
      </div>
    </section>
  );
}

function ReelCard({ card, showProject, onOpen }: { card: Card; showProject: boolean; onOpen: () => void }) {
  const { project, reel, stage, job } = card;
  const title = reelTitle(reel, project);
  const v = reel.lastVersion;
  const frames = reel.frames ?? (reel.thumbUrl ? [reel.thumbUrl] : []);
  const k = (reel.comments?.open ?? 0) + (reel.comments?.toReview ?? 0);
  const where = showProject && title !== project.name ? `${project.name} · ` : "";
  let chip: [string, string];
  let detail: ReactNode = null;
  const bar = (claude: boolean) =>
    job?.status === "running" ? (
      <span className={`hm-bar-p ${claude ? "cl" : ""}`} title={`${job.label} · ${Math.round(job.progress * 100)} %`}>
        <i style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
      </span>
    ) : job?.status === "queued" ? (
      <span className="c2">En file</span>
    ) : (
      <span className={`hm-bar-p ind ${claude ? "cl" : ""}`}>
        <i />
      </span>
    );
  switch (stage) {
    case "claude":
      chip = ["c", "Claude monte"];
      detail = bar(true);
      break;
    case "render":
      chip = ["", "Rendu"];
      detail = bar(false);
      break;
    case "error":
      chip = ["r", "Échec"];
      detail = <span className="c2 ell">{`${where}V${v?.n ?? "?"} · rendu en échec`}</span>;
      break;
    case "rushes": {
      const r = reel.rushes;
      const what = r && r.aroll + r.broll ? [r.aroll ? `${r.aroll} A-roll` : "", r.broll ? plural(r.broll, "B-roll") : ""].filter(Boolean).join(" · ") : "Vide";
      chip = ["", "Rushes"];
      detail = <span className="c2 ell">{`${where}${what}`}</span>;
      break;
    }
    case "review":
      chip = ["b", "À relire"];
      detail = <span className="c2 ell">{`${where}V${v?.n} · ${plural(k, "commentaire")}`}</span>;
      break;
    default:
      chip = ["g", "Prêt"];
      detail = <span className="c2 ell">{`${where}V${v?.n}${v ? ` · ${clock(v.durationSeconds)}` : ""}`}</span>;
  }
  return (
    <button className={`hm-card ${reel.active ? "active" : ""}`} onClick={onOpen} title={`${project.name} · ${reel.name}\nOuvrir dans un onglet`}>
      <div className="thumb">
        {[0, 1, 2].map((i) => (
          <Frame key={i} src={frames[i]} />
        ))}
      </div>
      <div className="t13 s ell hm-title">{title}</div>
      <div className="meta">
        <span className={`bd ${chip[0]}`}>{chip[1]}</span>
        {detail}
      </div>
    </button>
  );
}

function Frame({ src }: { src?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className="ph0" />;
  return <img src={src} alt="" loading="lazy" onError={() => setBad(true)} />;
}

/** Claude's card: its sessions and every running or queued job, across projects. */
function ClaudeQueue({ jobs, projects }: { jobs: Job[]; projects: ProjectSummary[] }) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const queue = jobs.filter(live).sort((a, b) => (a.status === b.status ? a.createdAt.localeCompare(b.createdAt) : a.status === "running" ? -1 : 1));
  // A Claude session gets its own row only when none of its project's jobs runs (they show it already).
  const sessions = projects.filter((p) => p.claudeRunning && !p.missing && !queue.some((j) => j.projectId === p.id && j.status === "running"));
  const running = sessions.length + queue.filter((j) => j.status === "running").length;
  const rows = [
    ...sessions.map((p) => {
      const r = p.reels.find((x) => x.claude);
      return { key: `c-${p.id}`, title: r ? reelTitle(r, p) : p.name, sub: "Claude au travail", claude: true, progress: undefined as number | undefined, queued: false };
    }),
    ...queue.map((j) => {
      const p = j.projectId ? byId.get(j.projectId) : undefined;
      const r = j.montageId ? p?.reels.find((x) => x.id === j.montageId) : undefined;
      return {
        key: j.id,
        title: r && p ? reelTitle(r, p) : (p?.name ?? "Cezane"),
        sub: j.label,
        claude: Boolean(p?.claudeRunning),
        progress: j.status === "running" ? j.progress : undefined,
        queued: j.status === "queued",
      };
    }),
  ];
  const shown = rows.slice(0, 6);
  return (
    <div className="hm-queue">
      <div className="hm-qh">
        <span className="av cl xs">C</span>
        <span className="s">Claude</span>
        <span className="c2" style={{ marginLeft: "auto" }}>
          {running ? `${running} en cours` : rows.length ? "en file" : "libre"}
        </span>
      </div>
      {!rows.length && <div className="c3">Rien en cours.</div>}
      {shown.map((r) => (
        <div key={r.key} className="hm-qrow">
          <div className="hm-qt">
            <span className="ell">{r.title}</span>
            <span className="c2">{r.queued ? "en file" : r.progress !== undefined ? `${Math.round(r.progress * 100)} %` : ""}</span>
          </div>
          <span className={`hm-bar-p ${r.claude ? "cl" : ""} ${r.progress === undefined && !r.queued ? "ind" : ""}`}>
            <i style={{ width: `${(r.progress ?? 0) * 100}%` }} />
          </span>
          <div className="c2 ell">{r.sub}</div>
        </div>
      ))}
      {rows.length > shown.length && <div className="c3">+ {rows.length - shown.length} autres</div>}
    </div>
  );
}
