import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
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
  checkReleaseMediaDirectory,
  releaseMediaPaths,
} from "../../scripts/updates/video-lib.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function releaseUpdateDefaultPropsIsInline(source: string): boolean {
  const file = ts.createSourceFile("Root.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let inline = false;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "Composition") {
      const namedAttribute = (property: ts.JsxAttributeLike, name: string) => ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name;
      const identifier = node.attributes.properties.find((property) => namedAttribute(property, "id"));
      const defaults = node.attributes.properties.find((property) => namedAttribute(property, "defaultProps"));
      if (identifier && defaults && ts.isJsxAttribute(identifier) && identifier.initializer?.kind === ts.SyntaxKind.StringLiteral && identifier.initializer.text === "ReleaseUpdate" && ts.isJsxAttribute(defaults) && defaults.initializer && ts.isJsxExpression(defaults.initializer) && defaults.initializer.expression && ts.isObjectLiteralExpression(defaults.initializer.expression)) inline = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return inline;
}

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

  it("caps transcript bytes before reading and counts the transcript in the aggregate release budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "reword-nerd-transcript-budget-"));
    temporaryRoots.push(root);
    const source = join(process.cwd(), "public/media/updates/v0-7-0");
    await Promise.all(["release-update.mp4", "release-update.webm", "poster.webp"].map((file) => copyFile(join(source, file), join(root, file))));
    const required = "reword-nerd v0.7.0 — Share the clean URL.\n";
    const atCap = `${required}${" ".repeat(RELEASE_VIDEO_BUDGETS.transcriptBytes - Buffer.byteLength(required))}`;
    await writeFile(join(root, "transcript.txt"), atCap);

    const boundary = await checkReleaseMediaDirectory(root, "0.7.0");
    expect(boundary.transcriptBytes).toBe(RELEASE_VIDEO_BUDGETS.transcriptBytes);
    expect(boundary.aggregateBytes).toBe(boundary.mp4.bytes + boundary.webm.bytes + boundary.poster.bytes + boundary.transcriptBytes);

    await writeFile(join(root, "transcript.txt"), `${atCap}x`);
    await expect(checkReleaseMediaDirectory(root, "0.7.0")).rejects.toThrow(new RegExp(`transcript exceeds its ${RELEASE_VIDEO_BUDGETS.transcriptBytes}-byte budget`));
  });

  it("keeps Remotion default props inline and threads an arbitrary validated version into editable scenes", async () => {
    // Replacing the Composition literal with an identifier or hard-coding v0.7 in an editable scene must make this fail.
    const [rootSource, contextSource, demonstrationSource] = await Promise.all([
      readFile(join(process.cwd(), "video/remotion/Root.tsx"), "utf8"),
      readFile(join(process.cwd(), "video/remotion/release/scenes/ContextScene.tsx"), "utf8"),
      readFile(join(process.cwd(), "video/remotion/release/scenes/DemonstrationScene.tsx"), "utf8"),
    ]);
    expect(releaseUpdateDefaultPropsIsInline(rootSource)).toBe(true);
    expect(contextSource).toContain("version");
    expect(contextSource).toContain("WHY v${version}");
    expect(demonstrationSource).toContain("version");
    expect(demonstrationSource).toContain("reword-nerd v${version}");
    expect(demonstrationSource).not.toContain("reword-nerd v0.7");
  });

  it("exposes a transactional publisher that restores a prior complete media set after final verification fails", async () => {
    // Publishing files one at a time, or failing without a restoration path, must make this leave a candidate transcript in the public target.
    const pipeline = await import("../../scripts/updates/video-lib.mjs") as Record<string, unknown>;
    const publisher = pipeline.publishReleaseMediaCandidate;
    const checkDirectory = pipeline.checkReleaseMediaDirectory;
    expect(publisher).toBeTypeOf("function");
    expect(checkDirectory).toBeTypeOf("function");

    const root = await mkdtemp(join(tmpdir(), "reword-nerd-video-transaction-"));
    temporaryRoots.push(root);
    const prior = join(root, "prior");
    const candidate = join(root, "candidate");
    const source = join(process.cwd(), "public/media/updates/v0-7-0");
    await Promise.all([mkdir(prior, { recursive: true }), mkdir(candidate, { recursive: true })]);
    await Promise.all(["release-update.mp4", "release-update.webm", "poster.webp", "transcript.txt"].flatMap((file) => [
      copyFile(join(source, file), join(prior, file)),
      copyFile(join(source, file), join(candidate, file)),
    ]));
    await writeFile(join(candidate, "transcript.txt"), "reword-nerd v0.7.0 — Share the clean URL. Candidate copy.\n");

    let checks = 0;
    await expect((publisher as (candidateDirectory: string, targetDirectory: string, version: string, check: (directory: string, version: string) => Promise<void>) => Promise<void>)(candidate, prior, "0.7.0", async (directory) => {
      checks += 1;
      await (checkDirectory as (directory: string, version: string) => Promise<void>)(directory, "0.7.0");
      if (checks === 2) throw new Error("injected final verification failure");
    })).rejects.toThrow(/injected final verification failure/i);

    expect(await readFile(join(prior, "transcript.txt"), "utf8")).not.toContain("Candidate copy.");
  });
});
