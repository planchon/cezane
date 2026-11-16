import { useEffect, useRef, useState } from "react";

/** A small modal: a question, maybe a text field, cancel / confirm. (Electron has no window.prompt.) */
type Req = {
  title: string;
  text?: string;
  input?: { label?: string; value?: string; placeholder?: string };
  confirm: string;
  danger?: boolean;
  resolve: (v: string | null) => void;
};

let show: ((r: Req) => void) | undefined;

/** Asks for a line of text. Resolves to the trimmed text, or null when cancelled or empty. */
export function askText(o: { title: string; text?: string; label?: string; value?: string; placeholder?: string; confirm: string }): Promise<string | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(null);
    show({ title: o.title, text: o.text, input: { label: o.label, value: o.value, placeholder: o.placeholder }, confirm: o.confirm, resolve });
  });
}

/** Asks for a yes / no. */
export function askConfirm(o: { title: string; text?: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false);
    show({ ...o, resolve: (v) => resolve(v !== null) });
  });
}

export function DialogHost() {
  const [req, setReq] = useState<Req>();
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    show = (r) => {
      setReq((old) => {
        old?.resolve(null);
        return r;
      });
      setValue(r.input?.value ?? "");
    };
    return () => {
      show = undefined;
    };
  }, []);
  useEffect(() => {
    if (req?.input) requestAnimationFrame(() => input.current?.select());
  }, [req]);
  if (!req) return null;
  const done = (v: string | null) => {
    req.resolve(v);
    setReq(undefined);
  };
  const ok = () => (req.input ? value.trim() && done(value.trim()) : done(""));
  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div
        className="dlg pop"
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        onKeyDown={(e) => {
          if (e.key === "Escape") done(null);
          else if (e.key === "Enter") ok();
        }}
      >
        <div className="t13 s">{req.title}</div>
        {req.text && <p className="c2">{req.text}</p>}
        {req.input && (
          <label className="dlg-field">
            {req.input.label && <span className="c2">{req.input.label}</span>}
            <input ref={input} className="field" value={value} placeholder={req.input.placeholder} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
          </label>
        )}
        <div className="dlg-acts">
          <button className="btn" onClick={() => done(null)}>
            Annuler
          </button>
          <button className={`btn ${req.danger ? "danger" : "pri"}`} disabled={Boolean(req.input) && !value.trim()} onClick={ok} autoFocus={!req.input}>
            {req.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
