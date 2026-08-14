import { useCurrentFrame } from "remotion";
import { ImageWorkbenchDemo } from "../components/ImageWorkbenchDemo";
import { ImageSceneShell } from "../components/ImageSceneShell";

export function ImageReviewScene() {
  const frame = useCurrentFrame();
  return <ImageSceneShell eyebrow="STEP 3 · REVIEW" title="Check warnings and optional local OCR"><ImageWorkbenchDemo stage="review" frame={frame} /></ImageSceneShell>;
}
