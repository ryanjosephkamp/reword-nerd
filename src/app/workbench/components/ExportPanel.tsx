import { CubeIcon } from "./Icons";

interface ExportPanelProps {
  disabled: boolean;
  status: "idle" | "busy" | "success" | "failure";
  message: string;
  onBuild(): void;
}

export function ExportPanel({ disabled, status, message, onBuild }: ExportPanelProps) {
  return <div className="export-panel">
    <button type="button" className="build-button" disabled={disabled} onClick={onBuild}>
      <CubeIcon />BUILD PACKAGE
    </button>
    <p>Package will be generated in-browser.<br />No files leave your device.</p>
    {message ? <p className={`export-message status-${status}`} role={status === "failure" ? "alert" : "status"}>{message}</p> : null}
  </div>;
}
