import { useCurrentFrame } from "remotion";
import { ImageWorkbenchDemo } from "../components/ImageWorkbenchDemo";
import { ImageSceneShell } from "../components/ImageSceneShell";

export function ImageIntakeScene() {
  const frame = useCurrentFrame();
  return <ImageSceneShell eyebrow="STEP 1 · ADD AND FOCUS" title="Add images or a folder, then select a card"><ImageWorkbenchDemo stage="intake" frame={frame} /></ImageSceneShell>;
}
