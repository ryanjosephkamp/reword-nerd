import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  IMAGE_QUICK_START_BUDGETS,
  IMAGE_QUICK_START_MINIMUM_FREE_BYTES,
  assertImageVideoDiskFloor,
  checkImageQuickStartMedia,
  imageQuickStartMediaPaths,
} from "../../scripts/media/image-quick-start-lib.mjs";

describe("Image Quick Start media pipeline", () => {
  it("publishes the dedicated tutorial to the existing same-origin demo surface", () => {
    expect(imageQuickStartMediaPaths()).toEqual({
      mp4Path: "/reword-nerd/media/demo/image-overview.mp4",
      webmPath: "/reword-nerd/media/demo/image-overview.webm",
      posterPath: "/reword-nerd/media/demo/image-overview-poster.webp",
    });
  });

  it("validates the final 40-second silent 1280x720 media within bounded budgets", async () => {
    const result = await checkImageQuickStartMedia(process.cwd());
    expect(result.mp4).toMatchObject({ codec: "h264", width: 1280, height: 720, fps: 30, audioStreams: 0 });
    expect(result.webm).toMatchObject({ codec: "vp9", width: 1280, height: 720, fps: 30, audioStreams: 0 });
    expect(result.poster).toMatchObject({ codec: "webp", width: 1280, height: 720, metadataTags: [] });
    expect(result.mp4.durationSeconds).toBeGreaterThanOrEqual(39.9);
    expect(result.mp4.durationSeconds).toBeLessThanOrEqual(40.1);
    expect(result.webm.durationSeconds).toBeGreaterThanOrEqual(39.9);
    expect(result.webm.durationSeconds).toBeLessThanOrEqual(40.1);
    expect(result.mp4.bytes).toBeLessThanOrEqual(IMAGE_QUICK_START_BUDGETS.mp4Bytes);
    expect(result.webm.bytes).toBeLessThanOrEqual(IMAGE_QUICK_START_BUDGETS.webmBytes);
    expect(result.poster.bytes).toBeLessThanOrEqual(IMAGE_QUICK_START_BUDGETS.posterBytes);
  });

  it("invokes the checked-in Remotion binary directly without pnpm or npx", async () => {
    const source = await readFile("scripts/media/image-quick-start-lib.mjs", "utf8");
    expect(source).toContain('join(root, "node_modules", ".bin", "remotion")');
    expect(source).not.toMatch(/\b(?:npx|pnpm)\b/u);
  });

  it("fails closed before rendering when the Data volume has less than 6 GiB free", async () => {
    const enoughBlocks = Number(IMAGE_QUICK_START_MINIMUM_FREE_BYTES / 4096n);
    await expect(assertImageVideoDiskFloor(process.cwd(), async () => ({ bavail: BigInt(enoughBlocks - 1), bsize: 4096n })))
      .rejects.toThrow(/at least 6 GiB/iu);
    await expect(assertImageVideoDiskFloor(process.cwd(), async () => ({ bavail: BigInt(enoughBlocks), bsize: 4096n })))
      .resolves.toBe(IMAGE_QUICK_START_MINIMUM_FREE_BYTES);
  });
});
