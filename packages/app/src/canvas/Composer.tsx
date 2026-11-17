import type { ModelInfo, ProjectFile } from "@cezane/core";
import { Check, ChevronDown, Globe, Hand, ImageIcon, MousePointer2, Plus, Smartphone, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type Editor, useValue } from "tldraw";
import { assetThumb } from "../api";
import { useApp } from "../store";
import { toast } from "../ui/toast";
import { flatten, useMedias } from "../medias/context";
import { createCard, normalizeUrl, placeRefs, type Ratio, RATIOS, ratioLabel, ratioNum, shapeAssetId } from "./generation";
import { cardSize } from "./shapes";

type CType = "image" | "capture-ios" | "capture-web";
type Mode = "screenshot" | "video";

const types: { id: CType; label: string; Icon: typeof ImageIcon }[] = [
  { id: "image", label: "Image", Icon: ImageIcon },
  { id: "capture-ios", label: "Capture simulateur", Icon: Smartphone },
  { id: "capture-web", label: "Capture web", Icon: Globe },
];

const placeholder: Record<CType, string> = {
  image: "Décris l'élément à créer…",
  "capture-ios": "Nom du fichier (facultatif) — capture le simulateur tel qu'il est",
  "capture-web": "Adresse de la page à capturer (https://…)",
};

const SIM_SECONDS = 8;

const load = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {}
};

/** Open state of a popover that closes on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/** A `.in` pill that opens a menu above it (the composer sits at the bottom of the canvas). */
function Dropdown({ label, icon, title, children }: { label: ReactNode; icon?: ReactNode; title?: string; children: (close: () => void) => ReactNode }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="md-dd" ref={ref}>
      <button className={`in ${open ? "open" : ""}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={title}>
        {icon}
        <span className="ell">{label}</span>
        <ChevronDown size={12} className="dd" />
      </button>
      {open && (
        <div className="pop menu md-menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Item({ on, disabled, onClick, children, sub, title }: { on?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <button role="menuitemradio" aria-checked={on} className="menu-item" disabled={disabled} onClick={onClick} title={title}>
      <span className="chk">{on && <Check size={12} />}</span>
      <span className="ell">{children}</span>
      {sub && <span className="c3 r">{sub}</span>}
    </button>
  );
}

/** Floating composer at the bottom of the canvas: what to make, its format, its references, the canvas tools, Générer. */
export function Composer({ editor, models }: { editor: Editor; models: ModelInfo[] }) {
  const m = useMedias();
  const [text, setText] = useState("");
  const [type, setTypeState] = useState<CType>(() => load("cezane.medias.type", ["image", "capture-ios", "capture-web"], "image"));
  const [ratio, setRatioState] = useState<Ratio>(() => load("cezane.medias.ratio", RATIOS, "9:16"));
  const [mode, setMode] = useState<Mode>("screenshot");
  // Checked against the registry below (the models arrive after the first render).
  const [modelKey, setModelKey] = useState(() => {
    try {
      return localStorage.getItem("cezane.medias.model") ?? "";
    } catch {
      return "";
    }
  });
  const input = useRef<HTMLTextAreaElement>(null);
  const tool = useValue("tool", () => editor.getCurrentToolId(), [editor]);

  const setType = (t: CType) => {
    setTypeState(t);
    save("cezane.medias.type", t);
    input.current?.focus();
  };
  const setRatio = (r: Ratio) => {
    setRatioState(r);
    save("cezane.medias.ratio", r);
  };

  const imageModels = models.filter((x) => x.kind === "image");
  const model = imageModels.find((x) => `${x.provider}/${x.id}` === modelKey && x.available) ?? imageModels.find((x) => x.available) ?? imageModels[0];
  const T = types.find((t) => t.id === type)!;

  // Grow with the prompt, up to 4 lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
  }, [text]);

  const ready = type === "image" ? Boolean(text.trim() && model?.available) : type === "capture-web" ? Boolean(normalizeUrl(text)) : true;

  const submit = () => {
    if (!ready) {
      if (type === "image" && model && !model.available) toast(`${model.label} indisponible${model.note ? ` : ${model.note}` : ""}`);
      return;
    }
    if (type === "image") {
      createCard(editor, { kind: "image", prompt: text.trim(), provider: model!.provider, model: model!.id, meta: { ratio, refs: [...m.refs] } }, cardSize("image", ratioNum(ratio), 1));
    } else if (type === "capture-web") {
      createCard(
        editor,
        { kind: "capture-web", prompt: normalizeUrl(text)!, provider: "capture", model: "web", meta: { ratio, capture: { mode } } },
        cardSize("capture-web", ratioNum(ratio), 1),
      );
    } else {
      createCard(
        editor,
        { kind: "capture-ios", prompt: text.trim(), provider: "capture", model: "ios", meta: { ratio: "9:16", capture: { mode, seconds: mode === "video" ? SIM_SECONDS : undefined } } },
        cardSize("capture-ios", 9 / 16, 1),
      );
    }
    setText("");
  };

  return (
    <div className="md-composer" onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={input}
        className="md-prompt"
        rows={1}
        placeholder={placeholder[type]}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="md-crow">
        <Dropdown label={T.label} icon={<T.Icon size={12} />} title={type === "image" && model ? `${model.label}` : undefined}>
          {(close) => (
            <>
              {types.map((t) => (
                <Item
                  key={t.id}
                  on={t.id === type}
                  onClick={() => {
                    setType(t.id);
                    close();
                  }}
                >
                  {t.label}
                </Item>
              ))}
              {type === "image" && imageModels.length > 0 && (
                <>
                  <div className="menu-sep" />
                  <div className="md-mh c2">Modèle</div>
                  {imageModels.map((x) => (
                    <Item
                      key={`${x.provider}/${x.id}`}
                      on={x === model}
                      disabled={!x.available}
                      title={x.note}
                      sub={!x.available ? "indisponible" : x.costEur > 0 ? `~${x.costEur.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} €` : "abonnement"}
                      onClick={() => {
                        setModelKey(`${x.provider}/${x.id}`);
                        save("cezane.medias.model", `${x.provider}/${x.id}`);
                        close();
                      }}
                    >
                      {x.label}
                    </Item>
                  ))}
                </>
              )}
            </>
          )}
        </Dropdown>
        {type !== "capture-ios" && (
          <Dropdown label={ratio} title={type === "capture-web" ? "Format de la fenêtre du navigateur" : "Format de l'image"}>
            {(close) =>
              RATIOS.map((r) => (
                <Item
                  key={r}
                  on={r === ratio}
                  sub={ratioLabel[r]}
                  onClick={() => {
                    setRatio(r);
                    close();
                  }}
                >
                  {r}
                </Item>
              ))
            }
          </Dropdown>
        )}
        {type !== "image" && (
          <Dropdown label={mode === "video" ? (type === "capture-ios" ? `Vidéo ${SIM_SECONDS} s` : "Vidéo défilée") : "Capture d'écran"}>
            {(close) => (
              <>
                <Item
                  on={mode === "screenshot"}
                  onClick={() => {
                    setMode("screenshot");
                    close();
                  }}
                >
                  Capture d'écran
                </Item>
                <Item
                  on={mode === "video"}
                  sub={type === "capture-ios" ? `${SIM_SECONDS} s` : "défilement"}
                  onClick={() => {
                    setMode("video");
                    close();
                  }}
                >
                  Vidéo
                </Item>
              </>
            )}
          </Dropdown>
        )}
        {type === "image" && <RefChip editor={editor} />}
        <span className="sp" />
        <button className={`ib ${tool === "select" ? "on" : ""}`} onClick={() => editor.setCurrentTool("select")} title="Sélection (V)">
          <MousePointer2 size={16} />
        </button>
        <button className={`ib ${tool === "hand" ? "on" : ""}`} onClick={() => editor.setCurrentTool("hand")} title="Main (H)">
          <Hand size={16} />
        </button>
        <button className="btn pri" disabled={!ready} onClick={submit}>
          {type === "image" ? "Générer" : "Capturer"}
        </button>
      </div>
    </div>
  );
}

const PICK_FOLDERS = ["Générés", "Rushes", "Captures"] as const;

/**
 * "1 référence": the files the next generation starts from. The menu lists them, adds the canvas
 * selection, and picks from the project's images and videos (placed on the canvas too).
 * A file dropped from the Finder on the canvas is also a reference.
 */
function RefChip({ editor }: { editor: Editor }) {
  const { state } = useApp();
  const m = useMedias();
  const { open, setOpen, ref } = usePopover();
  const [folder, setFolder] = useState<(typeof PICK_FOLDERS)[number]>(() => load("cezane.canvas.pick", PICK_FOLDERS, "Générés"));
  const selectedAssets = useValue(
    "selAssets",
    () =>
      editor
        .getSelectedShapes()
        .map((s) => shapeAssetId(editor, s))
        .filter((x): x is string => Boolean(x)),
    [editor],
  );
  const assets = state?.project.assets ?? [];
  const thumbOf = (id: string) => {
    const f = m.byAsset.get(id);
    const a = assets.find((x) => x.id === id);
    return f?.thumbUrl ?? (a ? assetThumb(a) : undefined);
  };
  const nameOf = (id: string) => m.byAsset.get(id)?.name ?? assets.find((x) => x.id === id)?.name ?? id;
  const fromCanvas = selectedAssets.filter((id) => !m.refs.includes(id));
  const n = m.refs.length;

  // The project's images and videos that can be a reference, per top folder, newest first.
  const pickable = useMemo(() => {
    const by = new Map<string, ProjectFile[]>();
    for (const node of m.listing?.folders ?? []) {
      const files = flatten([node]).filter((f) => f.assetId && (f.kind === "image" || f.kind === "video") && f.status !== "error");
      by.set(node.path, files.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    return by;
  }, [m.listing]);
  const list = pickable.get(folder) ?? [];

  const pick = (f: ProjectFile) => {
    if (m.refs.includes(f.assetId!)) return m.removeRef(f.assetId!);
    m.addRefs([f.assetId!]);
    placeRefs(editor, [{ assetId: f.assetId!, name: f.name, width: f.width, height: f.height, kind: f.kind }]);
  };

  return (
    <div className="md-dd" ref={ref}>
      <button className={`in ${n ? "" : "ghost"} ${open ? "open" : ""}`} onClick={() => setOpen(!open)} title="Références de la prochaine génération">
        {n ? (
          <span className="md-stack">
            {m.refs.slice(0, 3).map((id) => {
              const t = thumbOf(id);
              return t ? <img key={id} src={t} alt="" /> : <span key={id} className="ph" />;
            })}
          </span>
        ) : (
          <Plus size={12} />
        )}
        <span>{n ? `${n} référence${n > 1 ? "s" : ""}` : "Référence"}</span>
      </button>
      {open && (
        <div className="pop menu md-menu md-refs" role="menu">
          {m.refs.map((id) => {
            const t = thumbOf(id);
            return (
              <div key={id} className="menu-item md-ref-item">
                {t ? <img src={t} alt="" /> : <span className="ph" />}
                <span className="ell">{nameOf(id)}</span>
                <button className="ib" title="Retirer" onClick={() => m.removeRef(id)}>
                  <X size={12} />
                </button>
              </div>
            );
          })}
          {fromCanvas.length > 0 && (
            <button className="menu-item" onClick={() => m.addRefs(fromCanvas)}>
              <span className="chk">
                <Plus size={12} />
              </span>
              Ajouter la sélection du canvas ({fromCanvas.length})
            </button>
          )}
          {(n > 0 || fromCanvas.length > 0) && <div className="menu-sep" />}
          <div className="md-pick-h">
            {PICK_FOLDERS.map((p) => (
              <button
                key={p}
                className={`tab ${p === folder ? "on" : ""}`}
                onClick={() => {
                  setFolder(p);
                  save("cezane.canvas.pick", p);
                }}
              >
                {p}
                <span className="c3">{pickable.get(p)?.length ?? 0}</span>
              </button>
            ))}
          </div>
          {list.length ? (
            <div className="md-pick scroll">
              {list.map((f) => {
                const on = m.refs.includes(f.assetId!);
                return (
                  <button key={f.path} className={`md-pick-f ${on ? "on" : ""}`} onClick={() => pick(f)} title={on ? `${f.name} · retirer des références` : f.name}>
                    {f.thumbUrl ? <img src={f.thumbUrl} alt="" loading="lazy" draggable={false} /> : <span className="ph" />}
                    {on && (
                      <span className="md-pick-ok">
                        <Check size={10} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty md-hint">{m.listing ? `Aucune image ni vidéo dans ${folder}. Glisse un fichier du Finder sur le canvas.` : "Chargement…"}</div>
          )}
        </div>
      )}
    </div>
  );
}
