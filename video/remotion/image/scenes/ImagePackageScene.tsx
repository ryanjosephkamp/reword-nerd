import { useCurrentFrame } from "remotion";
import { ImageWorkbenchDemo } from "../components/ImageWorkbenchDemo";
import { ImageSceneShell } from "../components/ImageSceneShell";

export function ImagePackageScene() {
  const frame = useCurrentFrame();
  return <ImageSceneShell eyebrow="STEP 4 · BUILD AND DOWNLOAD" title="Confirm once, build in memory, download deliberately"><ImageWorkbenchDemo stage="package" frame={frame} /></ImageSceneShell>;
}
