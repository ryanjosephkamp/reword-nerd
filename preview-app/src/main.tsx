import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EntryApplication } from "./app/EntryApplication";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");

createRoot(root).render(
  <StrictMode>
    <EntryApplication />
  </StrictMode>,
);
