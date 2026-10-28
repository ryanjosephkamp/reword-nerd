import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/base.css";
import "./app.css";
import { App } from "./App";
import { useWorkspace } from "./store";
import { applyTheme, readTheme } from "./theme";

applyTheme(readTheme());

const requested = new URLSearchParams(window.location.search).get("mode");
if (requested === "images" || requested === "text") useWorkspace.getState().setMode(requested);

const root = document.getElementById("root");
if (!root) throw new Error("The page is missing its app container.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
