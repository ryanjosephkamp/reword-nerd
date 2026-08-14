import type { ImagePortalAction, ImagePortalState } from "../reducer";
import { selectImageConfirmation } from "./selectors";

export function ImageBuildDock({
  state,
  dispatch,
}: {
  state: ImagePortalState;
  dispatch(action: ImagePortalAction): boolean;
}) {
  const confirmation = selectImageConfirmation(state);
  return <section className="image-build-dock" aria-label="Image package status">
    <h3>IMAGE SET REVIEW</h3>
    <p className={confirmation.confirmed ? "image-confirmed" : "image-confirmation-guidance"}>{confirmation.guidance}</p>
    <button
      type="button"
      disabled={!confirmation.ready}
      onClick={() => dispatch({ type: "review/confirmed", expectedReviewGeneration: state.reviewGeneration })}
    >CONFIRM IMAGE SET</button>
    {confirmation.confirmed
      ? <p>Package export is not available in this preview. No ZIP has been created.</p>
      : null}
    <div className="image-package-actions">
      <button type="button" disabled>BUILD PACKAGE</button>
      <button type="button" disabled>DOWNLOAD ZIP</button>
    </div>
    <article className="image-package-preview" aria-label="Package preview">
      <h4>PACKAGE PREVIEW</h4>
      <p>No package has been built.</p>
    </article>
  </section>;
}
