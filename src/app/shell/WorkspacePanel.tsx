import { DownloadSimple, Trash, UploadSimple } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Dialog } from "../../ui/Dialog";
import { downloadBlob } from "../../ui/download";
import { exportWorkspace, importWorkspace } from "../persist";
import { hasWork, useWorkspace, workspaceData } from "../store";
import { setRemember, useSaveState } from "../useAutosave";

export function WorkspacePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { remember, error, changedElsewhere } = useSaveState();
  const replace = useWorkspace((state) => state.replace);
  const notify = useWorkspace((state) => state.notify);
  const clearText = useWorkspace((state) => state.clearText);
  const clearImages = useWorkspace((state) => state.clearImages);
  const empty = useWorkspace((state) => !hasWork(state));
  const importInput = useRef<HTMLInputElement>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  async function exportNow() {
    const blob = await exportWorkspace(workspaceData(useWorkspace.getState()));
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `reword-nerd-workspace-${date}.zip`);
  }

  async function importFile(file: File) {
    try {
      replace(await importWorkspace(file));
      notify("Workspace imported.");
      onClose();
    } catch (problem) {
      notify(
        problem instanceof Error ? problem.message : "That file couldn't be imported.",
        "error",
      );
    }
  }

  return (
    <Dialog open={open} title="Your workspace" onClose={onClose}>
      <div className="stack">
        <p className="muted">
          Everything you add stays in this browser. reword_nerd has no server, and nothing is sent
          anywhere unless you copy it or download it.
        </p>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => void setRemember(event.target.checked)}
          />
          <span>
            <strong>Save on this device</strong>
            <span className="muted">
              Keeps your files, settings, and replies between visits, in this browser only. Turn it
              off to remove the saved copy.
            </span>
          </span>
        </label>

        {error && <p className="callout callout-error">{error}</p>}
        {changedElsewhere && (
          <p className="callout">
            This workspace was saved in another tab. Reload this page to see that version.
          </p>
        )}

        <div className="button-row">
          <button type="button" className="btn" onClick={() => void exportNow()} disabled={empty}>
            <DownloadSimple aria-hidden />
            <span>Export workspace</span>
          </button>
          <button type="button" className="btn" onClick={() => importInput.current?.click()}>
            <UploadSimple aria-hidden />
            <span>Import workspace</span>
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
        <p className="muted small">
          An exported workspace is a ZIP you can keep, move to another computer, or import later.
        </p>

        <hr className="divider" />

        {confirmingClear ? (
          <div className="callout callout-error stack">
            <p>Remove every file, image, and reply from this workspace?</p>
            <div className="button-row">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  clearText();
                  clearImages();
                  setConfirmingClear(false);
                  onClose();
                }}
              >
                Remove everything
              </button>
              <button type="button" className="btn" onClick={() => setConfirmingClear(false)}>
                Keep my work
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setConfirmingClear(true)}
            disabled={empty}
          >
            <Trash aria-hidden />
            <span>Start over</span>
          </button>
        )}
      </div>
    </Dialog>
  );
}
