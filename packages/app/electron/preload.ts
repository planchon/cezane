// Preload of the Cezane window (sandboxed, context isolation on): the only native capability the
// page gets is the macOS folder picker, as window.cezane.pickFolder().
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cezane", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("cezane:pick-folder"),
});
