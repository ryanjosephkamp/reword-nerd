import { useCurrentFrame } from "remotion";
import { MockWorkbench } from "../components/MockWorkbench";
import { SceneShell } from "../components/SceneShell";

export function SettingsScene() {
  const frame = useCurrentFrame();
  return <SceneShell eyebrow="STEP 1" title="Choose the model and writing controls"><MockWorkbench focus="settings" frame={frame} /></SceneShell>;
}
