import { CubeIcon } from "./Icons";

interface ExportPanelProps {
  buildDisabled: boolean;
  downloadDisabled: boolean;
  status: "idle" | "building" | "ready" | "downloading" | "success" | "failure";
  message: string;
  guidance?: string;
  variant?: "stacked" | "dock";
  announce?: boolean;
  settingsMirror?: boolean;
  onBuild(): void;
  onDownload(): void;
}

export function ExportPanel({
  buildDisabled,
  downloadDisabled,
  status,
  message,
  guidance,
  variant = "stacked",
  announce = true,
  settingsMirror = false,
  onBuild,
  onDownload,
}: ExportPanelProps) {
  const statusCopy = message || guidance || "";
  const content = <>
    <button
      type="button"
      className="build-button"
      aria-label={settingsMirror ? "Build from Parameters" : undefined}
      disabled={buildDisabled}
      onClick={onBuild}
    >
      <CubeIcon />BUILD PACKAGE
    </button>
    <button
      type="button"
      className="download-button"
      aria-label={settingsMirror ? "Download from Parameters" : undefined}
      disabled={downloadDisabled}
      onClick={onDownload}
    >
      DOWNLOAD ZIP
    </button>
    {variant === "dock" ? <p
      className={`export-message export-dock-message status-${status}`}
      role={announce ? (status === "failure" ? "alert" : "status") : undefined}
    >
      {statusCopy}<span>Generated locally · no files leave your device</span>
    </p> : <>
      <p>Package will be generated in-browser.<br />No files leave your device.</p>
      {statusCopy ? <p
        className={`export-message status-${status}`}
        role={announce ? (status === "failure" ? "alert" : "status") : undefined}
      >{statusCopy}</p> : null}
    </>}
  </>;

  return variant === "dock"
    ? <section className="export-panel export-panel-dock" aria-label="Package actions">{content}</section>
    : <div className="export-panel">{content}</div>;
}
