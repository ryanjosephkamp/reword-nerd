import { Sequence } from "remotion";
import { ImageIntakeScene } from "./scenes/ImageIntakeScene";
import { ImagePackageScene } from "./scenes/ImagePackageScene";
import { ImagePortalScene } from "./scenes/ImagePortalScene";
import { ImageReviewScene } from "./scenes/ImageReviewScene";
import { ImageSettingsScene } from "./scenes/ImageSettingsScene";

export function ImageQuickStart() {
  return <>
    <Sequence from={0} durationInFrames={150}><ImagePortalScene /></Sequence>
    <Sequence from={150} durationInFrames={210}><ImageIntakeScene /></Sequence>
    <Sequence from={360} durationInFrames={250}><ImageSettingsScene /></Sequence>
    <Sequence from={610} durationInFrames={230}><ImageReviewScene /></Sequence>
    <Sequence from={840} durationInFrames={240}><ImagePackageScene /></Sequence>
    <Sequence from={1080} durationInFrames={120}><ImagePortalScene outro /></Sequence>
  </>;
}
