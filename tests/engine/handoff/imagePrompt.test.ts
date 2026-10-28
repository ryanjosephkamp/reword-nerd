import { describe, expect, it } from "vitest";
import type { ImageSettings, ImageSource } from "../../../src/engine/types";
import {
  buildImagePrompt,
  buildImageTaskZip,
  imageFileNames,
} from "../../../src/engine/handoff/imagePrompt";
import { readZip } from "../../../src/engine/handoff/zip";

const defaults: ImageSettings = {
  aspectRatio: "match-source",
  keepVisibleText: true,
  keepBackground: true,
  changes: "",
  mustKeep: "",
};

function image(overrides: Partial<ImageSource> = {}): ImageSource {
  return {
    id: "a",
    kind: "image",
    name: "Poster Final.png",
    from: null,
    original: new Blob(["png"], { type: "image/png" }),
    mimeType: "image/png",
    width: 1200,
    height: 800,
    byteCount: 3,
    sha256: "x",
    included: true,
    visibleText: "",
    settings: null,
    notes: [],
    ...overrides,
  };
}

describe("buildImagePrompt", () => {
  it("asks for a faithful new rendering by default", () => {
    const prompt = buildImagePrompt(image(), defaults, "grok-imagine");
    expect(prompt).toContain("Create a new image based on the attached reference image.");
    expect(prompt).toContain("background, including any transparency");
    expect(prompt).toContain("faithful new rendering");
    expect(prompt).toContain("(1200 × 800 pixels)");
    expect(prompt).toContain("Don't return the reference image unchanged.");
  });

  it("quotes recognized text and the requested change", () => {
    const prompt = buildImagePrompt(
      image({ visibleText: "Garden Day\nSaturday" }),
      { ...defaults, changes: "Make it autumn.", aspectRatio: "16:9", keepBackground: false },
      "chatgpt-images",
    );
    expect(prompt).toContain('Keep the visible text exactly as written: "Garden Day\\nSaturday".');
    expect(prompt).toContain("Change only this: Make it autumn.");
    expect(prompt).toContain("Aspect ratio: wide (16:9).");
    expect(prompt).not.toContain("transparency");
  });

  it("uses image-prompt wording for Midjourney", () => {
    expect(buildImagePrompt(image(), defaults, "midjourney")).toContain(
      "Use the attached image as an image prompt",
    );
  });
});

describe("imageFileNames", () => {
  it("keeps names unique and safe", () => {
    const names = imageFileNames([
      image({ id: "a", name: "Poster Final.png" }),
      image({ id: "b", name: "poster final.png" }),
      image({ id: "c", name: "photo.jpeg", mimeType: "image/jpeg" }),
    ]);
    expect([...names.values()]).toEqual(["Poster-Final.png", "poster-final-2.png", "photo.jpg"]);
  });
});

describe("buildImageTaskZip", () => {
  it("pairs each image with its prompt and an output path", async () => {
    const zip = await buildImageTaskZip([image()], defaults, "codex-images", "rn-images-1028-0905");
    const files = await readZip(zip, { want: () => true });
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual([
      "rn-images-1028-0905/AGENTS.md",
      "rn-images-1028-0905/CLAUDE.md",
      "rn-images-1028-0905/TASK.md",
      "rn-images-1028-0905/output/.keep",
      "rn-images-1028-0905/prompts/Poster-Final.md",
      "rn-images-1028-0905/source/Poster-Final.png",
    ]);
    const task = await files.find((file) => file.path.endsWith("TASK.md"))!.data.text();
    expect(task).toContain(
      "| `source/Poster-Final.png` | `prompts/Poster-Final.md` | `output/Poster-Final.png` |",
    );
  });
});
