import { Sequence } from "remotion";
import { ContextScene } from "./scenes/ContextScene";
import { DemonstrationScene } from "./scenes/DemonstrationScene";
import { FeedbackScene } from "./scenes/FeedbackScene";
import { HighlightsScene } from "./scenes/HighlightsScene";
import { TitleScene } from "./scenes/TitleScene";
import type { ReleaseUpdateProps } from "./ReleaseUpdate.contract";

export function ReleaseUpdate(props: ReleaseUpdateProps) {
  return <>
    <Sequence from={0} durationInFrames={150}><TitleScene {...props} /></Sequence>
    <Sequence from={150} durationInFrames={120}><ContextScene {...props} /></Sequence>
    <Sequence from={270} durationInFrames={210}><DemonstrationScene {...props} /></Sequence>
    <Sequence from={480} durationInFrames={120}><HighlightsScene {...props} /></Sequence>
    <Sequence from={600} durationInFrames={120}><FeedbackScene {...props} /></Sequence>
  </>;
}
