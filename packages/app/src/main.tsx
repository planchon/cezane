// Inter with its optical-size axis, bundled for offline use. The UI uses weights 450 and 550 only.
import "@fontsource-variable/inter/opsz.css";
import "tldraw/tldraw.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProvider } from "./store";

if (navigator.userAgent.includes("Electron")) document.documentElement.classList.add("is-electron");

createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
