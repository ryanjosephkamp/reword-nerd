import { useState } from "react";
import { CubeIcon } from "../../app/workbench/components/Icons";
import type { ImageDownloadResult } from "../export";
import type { ImagePortalAction, ImagePortalState } from "../reducer";
import { selectImageConfirmation } from "./selectors";

function formatPackageBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

export function ImageBuildDock({
  state,
  dispatch,
  buildPackage,
  downloadPackage,
}: {
  state: ImagePortalState;
  dispatch(action: ImagePortalAction): boolean;
  buildPackage(): Promise<boolean>;
  downloadPackage(): ImageDownloadResult;
}) {
  const confirmation = selectImageConfirmation(state);
  const [downloadFeedback, setDownloadFeedback] = useState({ key: "", message: "" });
  const outputKey = state.builtOutput
    ? `${state.builtOutput.builtForSessionGeneration}:${state.builtOutput.builtForReviewGeneration}:${state.builtOutput.buildGeneration}`
    : "";
  const downloadMessage = downloadFeedback.key === outputKey ? downloadFeedback.message : "";
  const canBuild = confirmation.confirmed && state.buildStatus !== "building";
  const canDownload = confirmation.confirmed && state.buildStatus === "ready" && state.builtOutput !== null;
  const fullHtml = state.builtOutput?.manifest.rootArtifacts.fullOpenMe;
  return <section className="image-build-dock" aria-label="Image package status">
    <h3>IMAGE SET REVIEW</h3>
    <p className={confirmation.confirmed ? "image-confirmed" : "image-confirmation-guidance"}>{confirmation.guidance}</p>
    <button
      type="button"
      className="image-confirm-button"
      disabled={!confirmation.ready}
      onClick={() => dispatch({ type: "review/confirmed", expectedReviewGeneration: state.reviewGeneration })}
    >CONFIRM IMAGE SET</button>
    {confirmation.confirmed && state.buildStatus !== "building"
      ? <p>Build creates a local ZIP in memory. Download remains a separate action.</p>
      : null}
    {state.buildStatus === "building"
      ? <p role="status" aria-live="polite">Building the local package…</p>
      : null}
    {state.buildStatus === "error" && state.safeBuildMessage
      ? <p role="alert">{state.safeBuildMessage}</p>
      : null}
    <div className="image-package-actions">
      <button
        type="button"
        className="image-build-button"
        disabled={!canBuild}
        onClick={() => { setDownloadFeedback({ key: "", message: "" }); void buildPackage(); }}
      ><CubeIcon />BUILD PACKAGE</button>
      <button
        type="button"
        className="image-download-button"
        disabled={!canDownload}
        onClick={() => {
          const result = downloadPackage();
          setDownloadFeedback({ key: outputKey, message: result.ok ? "Download started." : result.message });
        }}
      >DOWNLOAD ZIP</button>
    </div>
    {downloadMessage ? <p role="status" aria-live="polite">{downloadMessage}</p> : null}
    <article className="image-package-preview" aria-label="Package preview">
      <h4>PACKAGE PREVIEW</h4>
      {state.builtOutput
        ? <dl>
            <div><dt>Pairs</dt><dd>{state.builtOutput.itemCount} {state.builtOutput.itemCount === 1 ? "pair" : "pairs"}</dd></div>
            <div><dt>Package</dt><dd>{formatPackageBytes(state.builtOutput.packageByteCount)} ZIP</dd></div>
            <div><dt>SHA-256</dt><dd><code className="image-package-hash">{state.builtOutput.packageSha256}</code></dd></div>
            <div><dt>Full HTML</dt><dd>{fullHtml?.status === "generated"
              ? "Self-contained HTML generated."
              : "Self-contained HTML omitted at the 32 MiB limit."}</dd></div>
          </dl>
        : <p>No package has been built.</p>}
    </article>
  </section>;
}
