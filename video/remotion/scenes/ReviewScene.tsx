import { useCurrentFrame } from "remotion";
import { MockWorkbench } from "../components/MockWorkbench";
import { SceneShell } from "../components/SceneShell";

export function ReviewScene() {
  const frame = useCurrentFrame();
  return <SceneShell eyebrow="STEP 2" title="Review extracted text and figures"><MockWorkbench focus="review" frame={frame} /></SceneShell>;
}
