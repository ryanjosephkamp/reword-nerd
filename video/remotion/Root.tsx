import { Composition, Folder } from "remotion";
import { Overview } from "./compositions/Overview";
import { ReleaseUpdate } from "./release/ReleaseUpdate";
import { RELEASE_UPDATE_DURATION_IN_FRAMES, ReleaseUpdateSchema, releaseUpdateDefaultProps } from "./release/ReleaseUpdate.contract";
import { PackageScene } from "./scenes/PackageScene";
import { ReviewScene } from "./scenes/ReviewScene";
import { SettingsScene } from "./scenes/SettingsScene";

const format = { fps: 30, width: 1280, height: 720 } as const;

export function RemotionRoot() {
  return <>
    <Composition id="Overview" component={Overview} durationInFrames={1200} {...format} />
    <Composition
      id="ReleaseUpdate"
      component={ReleaseUpdate}
      durationInFrames={RELEASE_UPDATE_DURATION_IN_FRAMES}
      {...format}
      schema={ReleaseUpdateSchema}
      defaultProps={releaseUpdateDefaultProps}
    />
    <Folder name="Chapters">
      <Composition id="Settings" component={SettingsScene} durationInFrames={270} {...format} />
      <Composition id="Review" component={ReviewScene} durationInFrames={270} {...format} />
      <Composition id="Package" component={PackageScene} durationInFrames={270} {...format} />
    </Folder>
  </>;
}
