import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ImageApp } from "./ImageApp";
import "../styles/index.css";

const root = document.getElementById("root");

if (!root) throw new Error("The Image application root is missing.");

createRoot(root).render(<StrictMode><ImageApp /></StrictMode>);
