import {
  Article,
  CloudCheck,
  ImageSquare,
  Moon,
  Question,
  Sun,
  Warning,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useWorkspace, type Mode } from "../store";
import { applyTheme, effectiveTheme, readTheme, type ThemeChoice } from "../theme";
import { useSaveState } from "../useAutosave";
import { HelpDialog } from "./HelpDialog";
import { WorkspacePanel } from "./WorkspacePanel";

function saveLabel(
  remember: boolean,
  saving: boolean,
  savedAt: number | null,
  error: string | null,
) {
  if (error) return "Not saved";
  if (!remember) return "Not saved on this device";
  if (saving) return "Saving…";
  if (savedAt) {
    const time = new Date(savedAt).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `Saved ${time}`;
  }
  return "Saved on this device";
}

export function Header() {
  const mode = useWorkspace((state) => state.mode);
  const setMode = useWorkspace((state) => state.setMode);
  const textCount = useWorkspace((state) => state.sources.length);
  const imageCount = useWorkspace((state) => state.images.length);
  const { remember, saving, savedAt, error } = useSaveState();
  const [panelOpen, setPanelOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const dark = effectiveTheme(theme) === "dark";
  const status = saveLabel(remember, saving, savedAt, error);

  const modes: { id: Mode; label: string; count: number; icon: typeof Article }[] = [
    { id: "text", label: "Text", count: textCount, icon: Article },
    { id: "images", label: "Images", count: imageCount, icon: ImageSquare },
  ];

  return (
    <header className="app-header">
      <a className="brand" href="../" aria-label="reword_nerd home">
        <span className="brand-mark" aria-hidden>
          rn
        </span>
        <span className="brand-name">
          reword<span className="brand-underscore">_</span>nerd
        </span>
      </a>

      <nav className="mode-switch" aria-label="Workspace">
        {modes.map(({ id, label, count, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={mode === id ? "page" : undefined}
            onClick={() => {
              setMode(id);
              const url = new URL(window.location.href);
              url.searchParams.set("mode", id);
              window.history.replaceState(null, "", url);
            }}
          >
            <Icon aria-hidden />
            <span>{label}</span>
            {count > 0 && <span className="count">{count}</span>}
          </button>
        ))}
      </nav>

      <div className="header-actions">
        <button
          type="button"
          className={`save-status ${error ? "save-status-error" : remember ? "save-status-on" : ""}`}
          onClick={() => setPanelOpen(true)}
          aria-label={`${status}. Workspace options`}
          title={status}
        >
          {error ? <Warning aria-hidden /> : <CloudCheck aria-hidden />}
          <span aria-hidden>{status}</span>
        </button>
        <button
          type="button"
          className="btn-icon"
          aria-label={dark ? "Use light theme" : "Use dark theme"}
          onClick={() => {
            const next: ThemeChoice = dark ? "light" : "dark";
            applyTheme(next);
            setTheme(next);
          }}
        >
          {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
        </button>
        <button
          type="button"
          className="btn-icon"
          aria-label="How reword_nerd works"
          onClick={() => setHelpOpen(true)}
        >
          <Question aria-hidden />
        </button>
      </div>

      <WorkspacePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </header>
  );
}
