import { useEffect, useState } from "react";

type Action = { label: string; run: () => void };
type Msg = { text: string; action?: Action };

let push: ((m: Msg) => void) | undefined;

/** Shows a short message at the bottom of the window, maybe with one action ("Voir"). */
export function toast(msg: string, action?: Action) {
  push?.({ text: msg, action });
}

export function Toaster() {
  const [msg, setMsg] = useState<Msg>();
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    push = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(undefined), m.action ? 7000 : 3200);
    };
    return () => {
      push = undefined;
    };
  }, []);
  if (!msg) return null;
  return (
    <div className={`toast ${msg.action ? "act" : ""}`} role="status">
      {msg.text}
      {msg.action && (
        <button
          className="toast-btn"
          onClick={() => {
            msg.action!.run();
            setMsg(undefined);
          }}
        >
          {msg.action.label}
        </button>
      )}
    </div>
  );
}

/** Runs an async action and reports its error as a toast. */
export async function attempt<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(`Erreur : ${(e as Error).message ?? e}`);
    return undefined;
  }
}
