import { useEffect, useState } from "react";

let push: ((msg: string) => void) | undefined;

/** Shows a short message at the bottom of the window. */
export function toast(msg: string) {
  push?.(msg);
}

export function Toaster() {
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    push = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(undefined), 3200);
    };
    return () => {
      push = undefined;
    };
  }, []);
  return msg ? <div className="toast">{msg}</div> : null;
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
