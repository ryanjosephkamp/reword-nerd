import { useCurrentFrame } from "remotion";
import { ImageWorkbenchDemo } from "../components/ImageWorkbenchDemo";
import { ImageSceneShell } from "../components/ImageSceneShell";

export function ImageSettingsScene() {
  const frame = useCurrentFrame();
  return <ImageSceneShell eyebrow="STEP 2 · CONFIGURE" title="Select images and apply shared settings"><ImageWorkbenchDemo stage="settings" frame={frame} /></ImageSceneShell>;
}
