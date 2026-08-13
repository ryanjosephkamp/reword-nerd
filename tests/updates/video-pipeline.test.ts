import { describe, expect, it } from "vitest";
import {
  RELEASE_UPDATE_DURATION_IN_FRAMES,
  RELEASE_UPDATE_FPS,
  RELEASE_UPDATE_SIZE,
  ReleaseUpdateSchema,
  releaseUpdateDefaultProps,
} from "../../video/remotion/release/ReleaseUpdate.contract";
import {
  RELEASE_VIDEO_BUDGETS,
  checkReleaseMedia,
  releaseMediaPaths,
} from "../../scripts/updates/video-lib.mjs";

describe("v0.7 release video contract", () => {
  it("exposes a validated 24-second editable ReleaseUpdate composition", () => {
    // Removing the Zod schema or changing the video format must make this release-editor boundary fail.
    expect(RELEASE_UPDATE_SIZE).toEqual({ width: 1280, height: 720 });
    expect(RELEASE_UPDATE_FPS).toBe(30);
    expect(RELEASE_UPDATE_DURATION_IN_FRAMES).toBe(720);
    expect(ReleaseUpdateSchema.safeParse(releaseUpdateDefaultProps).success).toBe(true);
    expect(ReleaseUpdateSchema.safeParse({ ...releaseUpdateDefaultProps, highlights: ["Only two"] }).success).toBe(false);
  });

  it("keeps the final synthetic v0.7 release assets within the same-origin silent-media budget", async () => {
    // Removing an asset, audio check, duration check, or byte budget must make this final-release inspection fail.
    const paths = releaseMediaPaths("0.7.0");
    expect(paths).toEqual({
      mp4Path: "/reword-nerd/media/updates/v0-7-0/release-update.mp4",
      webmPath: "/reword-nerd/media/updates/v0-7-0/release-update.webm",
      posterPath: "/reword-nerd/media/updates/v0-7-0/poster.webp",
      transcriptPath: "/reword-nerd/media/updates/v0-7-0/transcript.txt",
    });

    const inspection = await checkReleaseMedia(process.cwd(), "0.7.0");
    expect(inspection.mp4).toMatchObject({ codec: "h264", width: 1280, height: 720, fps: 30, audioStreams: 0 });
    expect(inspection.webm).toMatchObject({ width: 1280, height: 720, fps: 30, audioStreams: 0 });
    expect(inspection.poster).toMatchObject({ codec: "webp", width: 1280, height: 720, metadataTags: [] });
    expect(inspection.mp4.durationSeconds).toBeGreaterThanOrEqual(20);
    expect(inspection.mp4.durationSeconds).toBeLessThanOrEqual(30);
    expect(inspection.webm.durationSeconds).toBeGreaterThanOrEqual(20);
    expect(inspection.webm.durationSeconds).toBeLessThanOrEqual(30);
    expect(inspection.webm.bytes).toBeLessThanOrEqual(RELEASE_VIDEO_BUDGETS.webmBytes);
    expect(inspection.mp4.bytes).toBeLessThanOrEqual(RELEASE_VIDEO_BUDGETS.mp4Bytes);
    expect(inspection.poster.bytes).toBeLessThanOrEqual(RELEASE_VIDEO_BUDGETS.posterBytes);
    expect(inspection.aggregateBytes).toBeLessThanOrEqual(RELEASE_VIDEO_BUDGETS.aggregateBytes);
  });
});
