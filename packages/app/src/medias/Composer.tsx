import type { ModelInfo } from "@cezane/core";
import { Check, ChevronDown, Globe, Hand, ImageIcon, MousePointer2, Plus, Smartphone, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Editor, useValue } from "tldraw";
import { assetThumb } from "../api";
import { useApp } from "../store";
import { toast } from "../ui/toast";
import { FILE_MIME, type FileDrag, useMedias } from "./context";
import { createCard, normalizeUrl, type Ratio, RATIOS, ratioLabel, ratioNum, shapeAssetId } from "./generation";
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
  const [over, setOver] = useState(false);
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
    <div
      className={`md-composer ${over ? "drop" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(FILE_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!e.dataTransfer.types.includes(FILE_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        const d = JSON.parse(e.dataTransfer.getData(FILE_MIME)) as FileDrag;
        if (d.assetId) m.addRefs([d.assetId]);
        else toast("Ce fichier n'est pas encore importé : il ne peut pas servir de référence.");
      }}
    >
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

/** "1 référence": the files the next generation starts from. Drop a file here or on the canvas to add one. */
function RefChip({ editor }: { editor: Editor }) {
  const { state } = useApp();
  const m = useMedias();
  const { open, setOpen, ref } = usePopover();
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
  const selFile = m.selected ? m.byPath.get(m.selected) : undefined;
  const fromViewer = selFile?.assetId && !m.refs.includes(selFile.assetId) && selFile.kind !== "audio" ? selFile : undefined;
  const n = m.refs.length;

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
          {n > 0 && (fromCanvas.length > 0 || fromViewer) && <div className="menu-sep" />}
          {fromCanvas.length > 0 && (
            <button className="menu-item" onClick={() => m.addRefs(fromCanvas)}>
              <span className="chk">
                <Plus size={12} />
              </span>
              Ajouter la sélection du canvas ({fromCanvas.length})
            </button>
          )}
          {fromViewer && (
            <button className="menu-item" onClick={() => m.addRefs([fromViewer.assetId!])}>
              <span className="chk">
                <Plus size={12} />
              </span>
              <span className="ell">Ajouter {fromViewer.name}</span>
            </button>
          )}
          {!n && !fromCanvas.length && !fromViewer && <div className="empty md-hint">Glisse un fichier de la colonne de gauche sur le canvas ou ici.</div>}
        </div>
      )}
    </div>
  );
}
