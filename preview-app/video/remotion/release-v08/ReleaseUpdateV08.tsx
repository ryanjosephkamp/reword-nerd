import { Sequence } from "remotion";
import type { ReleaseUpdateV08Props } from "./ReleaseUpdateV08.contract";
import { ImagePortalSceneV08 } from "./scenes/ImagePortalSceneV08";
import { LocalWorkflowSceneV08 } from "./scenes/LocalWorkflowSceneV08";
import { PrivacySceneV08 } from "./scenes/PrivacySceneV08";
import { TextPolishSceneV08 } from "./scenes/TextPolishSceneV08";
import { TitleSceneV08 } from "./scenes/TitleSceneV08";

export function ReleaseUpdateV08(props: ReleaseUpdateV08Props) {
  return <>
    <Sequence from={0} durationInFrames={132} premountFor={30}><TitleSceneV08 {...props} /></Sequence>
    <Sequence from={132} durationInFrames={144} premountFor={30}><ImagePortalSceneV08 /></Sequence>
    <Sequence from={276} durationInFrames={162} premountFor={30}><LocalWorkflowSceneV08 /></Sequence>
    <Sequence from={438} durationInFrames={150} premountFor={30}><TextPolishSceneV08 /></Sequence>
    <Sequence from={588} durationInFrames={132} premountFor={30}><PrivacySceneV08 {...props} /></Sequence>
  </>;
}
