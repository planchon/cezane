import { useCallback, useEffect, useRef, useState } from "react";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

function load(key: string): number | undefined {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function save(key: string, n: number | undefined) {
  try {
    if (n === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(n)));
  } catch {
    // Private window or blocked storage: the size simply isn't remembered.
  }
}

export type PanelSize = {
  size: number;
  min: number;
  max: number;
  initial: number;
  /** Live size while dragging (not saved). */
  set: (n: number) => void;
  /** Saves the current size. */
  commit: () => void;
  /** Back to the default size, forgetting the saved one. */
  reset: () => void;
};

/**
 * Size in px of a resizable panel, kept between `min` and `max` and saved in localStorage
 * (`cezane.size.<key>`). `max` can be a function of the window (re-read when it resizes).
 */
export function usePanelSize(key: string, initial: number, min: number, max: number | (() => number)): PanelSize {
  const storageKey = `cezane.size.${key}`;
  const [raw, setRaw] = useState(() => load(storageKey) ?? initial);
  const [, rerender] = useState(0);
  const maxFn = typeof max === "function";
  useEffect(() => {
    if (!maxFn) return;
    const onResize = () => rerender((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [maxFn]);
  const hi = Math.max(min, typeof max === "function" ? max() : max);
  const size = clamp(raw, min, hi);
  const latest = useRef(size);
  latest.current = size;
  const set = useCallback(
    (n: number) => {
      const v = clamp(n, min, typeof max === "function" ? max() : max);
      latest.current = v; // commit() right after the last move must see it before React re-renders
      setRaw(v);
    },
    [min, max],
  );
  const commit = useCallback(() => save(storageKey, latest.current), [storageKey]);
  const reset = useCallback(() => {
    latest.current = initial;
    setRaw(initial);
    save(storageKey, undefined);
  }, [storageKey, initial]);
  return { size, min, max: hi, initial, set, commit, reset };
}

type Edge = "left" | "right" | "top" | "bottom";

/**
 * Figma-like resize handle on one edge of its (positioned) parent: an 8 px hit zone, a 2 px bleu
 * Cézanne line on hover and while dragging, col/row-resize cursor, double-click to reset.
 */
export function Resizer({ edge, panel, grip, label = "Glisser pour redimensionner" }: { edge: Edge; panel: PanelSize; grip?: boolean; label?: string }) {
  const vertical = edge === "left" || edge === "right"; // the line is vertical: col-resize
  const sign = edge === "left" || edge === "top" ? -1 : 1; // dragging toward the panel's inside shrinks it
  const [dragging, setDragging] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const hideTip = () => {
    clearTimeout(timer.current);
    setTip(undefined);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hideTip();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = vertical ? e.clientX : e.clientY;
    const from = panel.size;
    const cls = vertical ? "resizing-x" : "resizing-y";
    document.documentElement.classList.add(cls);
    setDragging(true);
    const move = (ev: PointerEvent) => panel.set(from + sign * ((vertical ? ev.clientX : ev.clientY) - start));
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      document.documentElement.classList.remove(cls);
      setDragging(false);
      panel.commit();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8;
    const keys: Record<string, number> = vertical ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    panel.set(panel.size + sign * keys[e.key]! * step);
    panel.commit();
  };

  return (
    <div
      className={`rz ${vertical ? "x" : "y"} ${edge} ${dragging ? "on" : ""}`}
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(panel.size)}
      aria-valuemin={panel.min}
      aria-valuemax={Math.round(panel.max)}
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={panel.reset}
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => {
        const at = { x: e.clientX, y: e.clientY };
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setTip(at), 600);
      }}
      onPointerMove={(e) => {
        if (!dragging && !tip) {
          const at = { x: e.clientX, y: e.clientY };
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setTip(at), 600);
        }
      }}
      onPointerLeave={hideTip}
    >
      {grip && <span className="rz-grip" />}
      {tip && !dragging && (
        <span className={`rz-tip ${edge}`} style={{ left: tip.x, top: tip.y }}>
          {label}
        </span>
      )}
    </div>
  );
}
