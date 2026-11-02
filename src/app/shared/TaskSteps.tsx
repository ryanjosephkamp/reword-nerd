import { DownloadSimple, Terminal } from "@phosphor-icons/react";
import { useState } from "react";
import { guessShell, taskSlug, terminalCommand, type Shell } from "../../engine/handoff/commands";
import type { Destination } from "../../engine/handoff/destinations";
import { CopyButton } from "../../ui/CopyButton";
import { downloadBlob } from "../../ui/download";
import { Segmented } from "../../ui/Segmented";
import { useWorkspace } from "../store";

interface TaskStepsProps {
  target: Destination;
  title: string;
  /** Builds the ZIP whose single top-level folder is named after the slug. */
  build: (slug: string) => Promise<Blob>;
  what: string;
}

/** The two-step agent hand-off: download the task folder, then paste one command. */
export function TaskSteps({ target, title, build, what }: TaskStepsProps) {
  const notify = useWorkspace((state) => state.notify);
  const [slug, setSlug] = useState<string | null>(null);
  const [shell, setShell] = useState<Shell>(() => guessShell());
  const [building, setBuilding] = useState(false);

  async function download() {
    setBuilding(true);
    try {
      const next = taskSlug(title);
      downloadBlob(await build(next), `${next}.zip`);
      setSlug(next);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The task folder couldn't be built.",
        "error",
      );
    } finally {
      setBuilding(false);
    }
  }

  const command = slug ? terminalCommand(slug, target, shell) : null;
  return (
    <ol className="steps">
      <li>
        <p className="step-title">Download the task folder</p>
        <p className="muted small">{what}</p>
        <button type="button" className="btn btn-primary" onClick={download} disabled={building}>
          <DownloadSimple aria-hidden />
          <span>{building ? "Building…" : slug ? "Download again" : "Download task folder"}</span>
        </button>
      </li>
      <li>
        <p className="step-title">Paste this in a terminal</p>
        {command ? (
          <>
            <div className="command">
              <Terminal aria-hidden />
              <code>{command}</code>
            </div>
            <div className="button-row">
              <CopyButton text={command} label="Copy command" className="btn btn-primary" />
              <Segmented
                label="Terminal"
                hideLabel
                value={shell}
                options={[
                  { value: "unix", label: "macOS & Linux" },
                  { value: "powershell", label: "Windows" },
                ]}
                onChange={setShell}
              />
            </div>
            <p className="muted small">
              {target.hint} Saved downloads somewhere other than Downloads? Change that part of the
              command.
            </p>
          </>
        ) : (
          <p className="muted small">The command appears after you download the folder.</p>
        )}
      </li>
    </ol>
  );
}
