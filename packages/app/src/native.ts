/** What the Electron preload exposes (electron/preload.ts). Absent in a plain browser. */
type CezaneBridge = { pickFolder: () => Promise<string | null> };

declare global {
  interface Window {
    cezane?: CezaneBridge;
  }
}

/** True in the Electron app (native folder picker available). */
export const hasNativePicker = () => typeof window.cezane?.pickFolder === "function";

/** The macOS folder picker; null when cancelled or outside Electron. */
export async function pickFolder(): Promise<string | null> {
  try {
    return (await window.cezane?.pickFolder()) ?? null;
  } catch {
    return null;
  }
}
