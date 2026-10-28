import { FolderOpen, FileZip } from "@phosphor-icons/react";
import { useRef } from "react";
import { readZip } from "../../engine/handoff/zip";
import { DropZone } from "../../ui/DropZone";
import { readFolderInput, type Picked } from "../../ui/picked";
import { scopedSources } from "../batch";
import { agentOutput } from "./agentOutput";
import { useWorkspace } from "../store";

export function BringBack({ kind }: { kind: "agent" | "chat" }) {
  const sources = useWorkspace((state) => state.sources);
  const scope = useWorkspace((state) => state.scope);
  const selectedId = useWorkspace((state) => state.selectedSourceId);
  const stepByStep = useWorkspace((state) => state.stepByStep);
  const textResult = useWorkspace((state) => state.textResult);
  const setTextResult = useWorkspace((state) => state.setTextResult);
  const notify = useWorkspace((state) => state.notify);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const sourceIds = () => scopedSources(sources, scope, selectedId).map((source) => source.id);

  async function takeAgentFiles(files: { path: string; data: Blob }[]) {
    const found = agentOutput(files);
    if (found.files.length === 0) {
      notify(
        "No results found there. Drop the task folder after your agent has finished.",
        "error",
      );
      return;
    }
    const report = found.report ? await found.report.text() : null;
    setTextResult({ sourceIds: sourceIds(), reply: null, files: found.files, report });
    notify(`Found ${found.files.length} ${found.files.length === 1 ? "result" : "results"}.`);
  }

  async function takePicked(picked: Picked) {
    const zip = picked.files.find((file) => file.name.toLowerCase().endsWith(".zip"));
    if (zip) {
      try {
        await takeAgentFiles(await readZip(zip));
      } catch {
        notify("That ZIP couldn't be opened.", "error");
      }
      return;
    }
    await takeAgentFiles([
      ...picked.folder.map((entry) => ({ path: entry.path, data: entry.file as Blob })),
      ...picked.files.map((file) => ({ path: file.name, data: file as Blob })),
    ]);
  }

  return (
    <details className="bring-back" open={textResult !== null}>
      <summary>
        <span className="step-title">Bring the result back</span>
        <span className="muted small"> optional</span>
      </summary>
      <div className="stack">
        {kind === "chat" && !stepByStep && (
          <label className="field">
            <span className="field-label">Paste the model's reply to compare and export it</span>
            <textarea
              rows={4}
              value={textResult?.reply ?? ""}
              onChange={(event) =>
                setTextResult(
                  event.target.value.trim()
                    ? {
                        sourceIds: sourceIds(),
                        reply: event.target.value,
                        files: null,
                        report: null,
                      }
                    : null,
                )
              }
            />
          </label>
        )}
        {kind === "agent" && (
          <DropZone
            onPick={(picked) => void takePicked(picked)}
            label="Drop the finished task folder"
          >
            <div className="drop-target">
              <p>Drop the finished task folder here, or choose it.</p>
              <div className="button-row">
                <button type="button" className="btn" onClick={() => folderInput.current?.click()}>
                  <FolderOpen aria-hidden />
                  <span>Choose folder</span>
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => zipInput.current?.click()}
                >
                  <FileZip aria-hidden />
                  <span>Choose ZIP</span>
                </button>
              </div>
              <input
                ref={folderInput}
                type="file"
                hidden
                // @ts-expect-error webkitdirectory is supported by every current browser but not typed.
                webkitdirectory=""
                onChange={(event) => {
                  const list = event.target.files;
                  if (list?.length) void takePicked(readFolderInput(list));
                  event.target.value = "";
                }}
              />
              <input
                ref={zipInput}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void takePicked({ files: [file], folder: [] });
                }}
              />
            </div>
          </DropZone>
        )}
        {textResult && (
          <p className="muted small">
            The comparison is open in the middle of the screen.{" "}
            <button type="button" className="link-button" onClick={() => setTextResult(null)}>
              Clear the result
            </button>
          </p>
        )}
      </div>
    </details>
  );
}
