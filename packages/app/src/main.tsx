import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
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
