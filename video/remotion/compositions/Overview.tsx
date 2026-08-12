import { Sequence } from "remotion";
import { IntroScene } from "../scenes/IntroScene";
import { PackageScene } from "../scenes/PackageScene";
import { ReviewScene } from "../scenes/ReviewScene";
import { SettingsScene } from "../scenes/SettingsScene";

export function Overview() {
  return <>
    <Sequence from={0} durationInFrames={120}><IntroScene /></Sequence>
    <Sequence from={120} durationInFrames={300}><SettingsScene /></Sequence>
    <Sequence from={420} durationInFrames={330}><ReviewScene /></Sequence>
    <Sequence from={750} durationInFrames={330}><PackageScene /></Sequence>
    <Sequence from={1080} durationInFrames={120}><IntroScene outro /></Sequence>
  </>;
}
