import { Composition, Folder } from "remotion";
import { Overview } from "./compositions/Overview";
import { ImageQuickStart } from "./image/ImageQuickStart";
import { ReleaseUpdate } from "./release/ReleaseUpdate";
import { RELEASE_UPDATE_DURATION_IN_FRAMES, ReleaseUpdateSchema } from "./release/ReleaseUpdate.contract";
import { ReleaseUpdateV08 } from "./release-v08/ReleaseUpdateV08";
import { RELEASE_UPDATE_V08_DURATION_IN_FRAMES, ReleaseUpdateV08Schema } from "./release-v08/ReleaseUpdateV08.contract";
import { PackageScene } from "./scenes/PackageScene";
import { ReviewScene } from "./scenes/ReviewScene";
import { SettingsScene } from "./scenes/SettingsScene";

const format = { fps: 30, width: 1280, height: 720 } as const;

export function RemotionRoot() {
  return <>
    <Composition id="Overview" component={Overview} durationInFrames={1200} {...format} />
    <Composition id="ImageQuickStart" component={ImageQuickStart} durationInFrames={1200} {...format} />
    <Composition
      id="ReleaseUpdate"
      component={ReleaseUpdate}
      durationInFrames={RELEASE_UPDATE_DURATION_IN_FRAMES}
      {...format}
      schema={ReleaseUpdateSchema}
      defaultProps={{
        version: "0.7.0",
        title: "Updates, feedback, and Share",
        context: "A static builder’s journal and small community routes make each release easier to inspect, discuss, and pass along without adding a publishing backend.",
        demonstrationLabel: "See the release surface in action",
        highlights: ["Static Updates pages with RSS", "Clear bug and feature routes", "Canonical Share with no tracking"],
        feedback: {
          bugLabel: "REPORT A BUG",
          featureLabel: "SUGGEST A FEATURE",
          shareLabel: "SHARE RELEASE",
          closingLine: "Built in public. Processed locally.",
        },
      }}
    />
    <Composition
      id="ReleaseUpdateV08"
      component={ReleaseUpdateV08}
      durationInFrames={RELEASE_UPDATE_V08_DURATION_IN_FRAMES}
      {...format}
      schema={ReleaseUpdateV08Schema}
      defaultProps={{
        version: "0.8.0",
        accent: "#ff9f1c",
        title: "IMAGE prompt packages",
        subtitle: "Added a local-first companion workbench, then polished review and export across both portals.",
        closingLine: "No model runs. Nothing uploads. Download only when ready.",
      }}
    />
    <Folder name="Chapters">
      <Composition id="Settings" component={SettingsScene} durationInFrames={270} {...format} />
      <Composition id="Review" component={ReviewScene} durationInFrames={270} {...format} />
      <Composition id="Package" component={PackageScene} durationInFrames={270} {...format} />
    </Folder>
  </>;
}
