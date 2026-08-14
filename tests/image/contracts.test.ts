import { Blob as NativeBlob } from "node:buffer";
import {
  DEFAULT_IMAGE_PROMPT_SETTINGS,
  copyImageBytes,
  createImagePortalItem,
} from "../../src/image/contracts";

describe("Image domain contracts", () => {
  it("owns exact source bytes instead of retaining mutable caller or result buffers", async () => {
    // Catches an admission path retaining the caller's mutable Uint8Array by reference.
    const callerBytes = new Uint8Array([137, 80, 78, 71]);
    const item = createImagePortalItem({
      id: "image-1",
      incarnation: 1,
      bytes: callerBytes,
      sourceHash: "sha256-source-1",
      mimeType: "image/png",
      fileExtension: "png",
      width: 2,
      height: 1,
      provenance: {
        intakeKind: "direct",
        sourceName: "tiny.png",
        sourcePath: null,
        containerName: null,
        containerHash: null,
        containerPath: null,
        pageNumber: null,
        relationshipId: null,
      },
      settings: DEFAULT_IMAGE_PROMPT_SETTINGS,
      warnings: ["Exact bytes may contain metadata."],
    });

    callerBytes[0] = 0;
    const firstRead = await copyImageBytes(item.sourceBytes, 4);
    firstRead[1] = 0;

    expect(Array.from(await copyImageBytes(item.sourceBytes, 4))).toEqual([137, 80, 78, 71]);
    expect(item.sourceBytes.size).toBe(4);
    expect(item.sourceHash).toBe("sha256-source-1");
    expect(item.dimensions).toEqual({ width: 2, height: 1, megapixels: 0.000002 });
  });

  it("preserves exact source bytes through a browser-native structured clone", async () => {
    // Catches retained byte custody using functions or class state that workers/deep snapshots cannot clone.
    const jsdomBlob = globalThis.Blob;
    Object.defineProperty(globalThis, "Blob", { configurable: true, value: NativeBlob });
    try {
      const item = createImagePortalItem({
        id: "cloneable-image",
        incarnation: 2,
        bytes: new Uint8Array([0, 255, 17, 34]),
        sourceHash: "cloneable-hash",
        mimeType: "image/png",
        fileExtension: "png",
        width: 1,
        height: 1,
        provenance: {
          intakeKind: "direct",
          sourceName: "cloneable.png",
          sourcePath: null,
          containerName: null,
          containerHash: null,
          containerPath: null,
          pageNumber: null,
          relationshipId: null,
        },
        settings: DEFAULT_IMAGE_PROMPT_SETTINGS,
      });

      const cloned = structuredClone(item);

      expect(cloned.sourceBytes).toBeInstanceOf(NativeBlob);
      expect(cloned.sourceBytes.type).toBe("image/png");
      expect(Array.from(await copyImageBytes(cloned.sourceBytes, 4))).toEqual([0, 255, 17, 34]);
      await expect(copyImageBytes(cloned.sourceBytes, 3)).rejects.toThrow("IMAGE_BYTES_LIMIT_EXCEEDED");
    } finally {
      Object.defineProperty(globalThis, "Blob", { configurable: true, value: jsdomBlob });
    }
  });

  it("snapshots provenance, warnings, and settings for a newly admitted item", () => {
    // Catches defaults or provenance leaking into already-admitted items through shared references.
    const settings = {
      ...DEFAULT_IMAGE_PROMPT_SETTINGS,
      requestedChanges: "Make the border orange.",
    };
    const warnings = ["Review fine text."];
    const provenance = {
      intakeKind: "zip" as const,
      sourceName: "card.webp",
      sourcePath: "assets/card.webp",
      containerName: "bundle.zip",
      containerHash: "sha256-container",
      containerPath: "assets/card.webp",
      pageNumber: null,
      relationshipId: null,
    };

    const item = createImagePortalItem({
      id: "image-2",
      incarnation: 3,
      bytes: new Uint8Array([1, 2, 3]),
      sourceHash: "sha256-source-2",
      mimeType: "image/webp",
      fileExtension: "webp",
      width: 400,
      height: 300,
      provenance,
      settings,
      warnings,
    });

    settings.requestedChanges = "Changed after admission.";
    warnings[0] = "Changed after admission.";
    provenance.sourcePath = "changed.webp";

    expect(item.settings.requestedChanges).toBe("Make the border orange.");
    expect(item.warnings).toEqual(["Review fine text."]);
    expect(item.provenance.sourcePath).toBe("assets/card.webp");
    expect(item.included).toBe(true);
    expect(item.bulkSelected).toBe(false);
    expect(item.ocr).toEqual({
      status: "off",
      detectedText: null,
      reviewedText: null,
      operationGeneration: 0,
      reviewRevision: 0,
    });
    expect(item.reviewRevision).toBe(0);
  });

  it("uses the approved first-admission image defaults", () => {
    // Catches a new item starting with provider-specific or identity-promising settings.
    expect(DEFAULT_IMAGE_PROMPT_SETTINGS).toEqual({
      modelFamily: "openai-gpt-image",
      aspectRatio: "match-source",
      sizeIntent: "match-source-where-supported",
      preserveVisibleText: true,
      backgroundBehavior: "preserve-source",
      requestedChanges: "",
      mustPreserve: "",
    });
  });
});
