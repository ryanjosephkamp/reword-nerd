import { useCurrentFrame } from "remotion";
import { MockWorkbench } from "../components/MockWorkbench";
import { SceneShell } from "../components/SceneShell";

export function PackageScene() {
  const frame = useCurrentFrame();
  return <SceneShell eyebrow="STEP 3" title="Build once, then choose your workflow"><MockWorkbench focus="package" frame={frame} /></SceneShell>;
}
