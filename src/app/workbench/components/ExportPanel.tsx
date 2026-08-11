import { CubeIcon } from "./Icons";

interface ExportPanelProps {
  buildDisabled: boolean;
  downloadDisabled: boolean;
  status: "idle" | "building" | "ready" | "downloading" | "success" | "failure";
  message: string;
  onBuild(): void;
  onDownload(): void;
}

export function ExportPanel({ buildDisabled, downloadDisabled, status, message, onBuild, onDownload }: ExportPanelProps) {
  return <div className="export-panel">
    <button type="button" className="build-button" disabled={buildDisabled} onClick={onBuild}>
      <CubeIcon />BUILD PACKAGE
    </button>
    <button type="button" className="download-button" disabled={downloadDisabled} onClick={onDownload}>
      DOWNLOAD ZIP
    </button>
    <p>Package will be generated in-browser.<br />No files leave your device.</p>
    {message ? <p className={`export-message status-${status}`} role={status === "failure" ? "alert" : "status"}>{message}</p> : null}
  </div>;
}
