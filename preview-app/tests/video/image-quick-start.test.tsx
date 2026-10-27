import { Children, isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { RemotionRoot } from "../../video/remotion/Root";

describe("Image Quick Start Remotion contract", () => {
  it("registers a dedicated 40-second 1280x720 Image tutorial instead of reusing the Text overview", () => {
    // Removing the Image composition or aliasing it to Overview must make this fail.
    const root = RemotionRoot() as ReactElement<{ children?: React.ReactNode }>;
    const compositions = Children.toArray(root.props.children)
      .filter(isValidElement)
      .map((element) => element.props as Record<string, unknown>);
    const image = compositions.find((props) => props.id === "ImageQuickStart");
    const text = compositions.find((props) => props.id === "Overview");

    expect(image).toMatchObject({
      id: "ImageQuickStart",
      durationInFrames: 1200,
      fps: 30,
      width: 1280,
      height: 720,
    });
    expect(image?.component).not.toBe(text?.component);
  });
});
