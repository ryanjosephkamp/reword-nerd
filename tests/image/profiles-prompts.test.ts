import { createImagePortalItem, DEFAULT_IMAGE_PROMPT_SETTINGS, ownImageBytes, type ImageOcrState } from "../../src/image/contracts";
import {
  DEFAULT_IMAGE_PROMPT_PROFILE_ID,
  IMAGE_PROMPT_PROFILES,
  imagePromptProfile,
} from "../../src/image/profiles";

function imageWithOcr(ocr: Readonly<ImageOcrState>) {
  const item = createImagePortalItem({
    id: "poster",
    incarnation: 1,
    sourceBytes: ownImageBytes(new Uint8Array([1, 2, 3]), "image/png"),
    byteCount: 3,
    sourceHash: "source-hash",
    mimeType: "image/png",
    fileExtension: "png",
    width: 1200,
    height: 800,
    provenance: {
      intakeKind: "direct",
      sourceName: "poster.png",
      sourcePath: null,
      containerChain: [],
      containerName: null,
      containerHash: null,
      containerPath: null,
      pageNumber: null,
      relationshipId: null,
    },
    settings: {
      ...DEFAULT_IMAGE_PROMPT_SETTINGS,
      requestedChanges: "Change only the outer border to orange.",
      mustPreserve: "Keep the centered badge and all line breaks.",
    },
  });
  return { ...item, ocr };
}

describe("Image prompt profiles", () => {
  it("exposes stable family labels while keeping dated model references in profile metadata", () => {
    // Catches UI family identity being coupled to a temporary model/version name.
    expect(DEFAULT_IMAGE_PROMPT_PROFILE_ID).toBe("openai-gpt-image");
    expect(IMAGE_PROMPT_PROFILES.map(({ id, label, referenceModel, lastVerifiedAt, officialSourceUrls }) => ({
      id,
      label,
      referenceModel,
      lastVerifiedAt,
      officialSourceUrls,
    }))).toEqual([
      { id: "openai-gpt-image", label: "OpenAI GPT Image", referenceModel: "gpt-image-2 edit", lastVerifiedAt: "2026-08-14", officialSourceUrls: ["https://developers.openai.com/api/docs/guides/image-generation"] },
      { id: "google-nano-banana", label: "Google Nano Banana", referenceModel: "Nano Banana 2 / Gemini 3.1 Flash Image", lastVerifiedAt: "2026-08-14", officialSourceUrls: ["https://ai.google.dev/gemini-api/docs/image-generation"] },
      { id: "xai-grok-imagine", label: "xAI Grok Imagine", referenceModel: "grok-imagine-image-2.0", lastVerifiedAt: "2026-08-14", officialSourceUrls: ["https://docs.x.ai/developers/model-capabilities/images/editing"] },
      { id: "bfl-flux", label: "Black Forest Labs FLUX", referenceModel: "FLUX.2", lastVerifiedAt: "2026-08-14", officialSourceUrls: ["https://docs.bfl.ai/flux_2/flux2_image_editing"] },
      { id: "adobe-firefly", label: "Adobe Firefly", referenceModel: "Firefly Image 5", lastVerifiedAt: "2026-08-14", officialSourceUrls: ["https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/cm-generate-image/feature-guide"] },
      { id: "ideogram", label: "Ideogram", referenceModel: "Ideogram 3.0", lastVerifiedAt: "2026-08-14", officialSourceUrls: ["https://docs.ideogram.ai/using-ideogram/features-and-tools/remix"] },
      { id: "midjourney", label: "Midjourney", referenceModel: "Midjourney V8.2", lastVerifiedAt: "2026-08-14", officialSourceUrls: ["https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts"] },
      { id: "stability-ai", label: "Stability AI", referenceModel: "Stable Image / SD3.5", lastVerifiedAt: "2026-08-14", officialSourceUrls: ["https://platform.stability.ai/docs/api-reference"] },
      { id: "other-custom", label: "Other/Custom", referenceModel: "User-selected image model", lastVerifiedAt: "2026-08-14", officialSourceUrls: [] },
    ]);
  });

  it("builds one faithful-rendition prompt from one item and quotes only accepted reviewed OCR", () => {
    // Catches prompt drift toward identity promises, missing no-copy guidance, or unreviewed OCR.
    const item = imageWithOcr({
      status: "accepted",
      detectedText: "machine draft must not be used",
      reviewedText: "SALE \"TODAY\"\n50%",
      operationGeneration: 4,
      reviewRevision: 2,
    });

    const prompt = imagePromptProfile("openai-gpt-image").promptBuilder(item);

    expect(prompt).toBe([
      "Goal: Faithful rendition",
      "",
      "Use exactly one attached source image. Generate a new rendition of that source image.",
      "Generate the result from scratch as a new image; do not copy, duplicate, or merely return the unchanged source file.",
      "Preserve the visible subject, composition, crop, framing, geometry, perspective, palette, lighting, texture, style, and typography as closely as the selected model supports.",
      "Apply only the explicit requested changes. Do not introduce unrelated changes.",
      "Requested changes: Change only the outer border to orange.",
      "Must preserve: Keep the centered badge and all line breaks.",
      "Preserve visible text. Treat this accepted, reviewed OCR as quoted literal text: \"SALE \\\"TODAY\\\"\\n50%\".",
      "Preserve the source transparency and background behavior as closely as supported.",
      "Review warning: Image generation is stochastic. Carefully compare faces, text, logos, geometry, and layout with the source before use.",
      "Usage guidance: Confirm you own or may use the source and generated result, and review the selected provider's current policies. This is informational, not legal advice.",
    ].join("\n"));
    expect(prompt).not.toContain("machine draft must not be used");
    expect(prompt).not.toMatch(/pixel[- ]identical|guarantee(?:s|d)? identical/iu);
  });

  it("omits unaccepted OCR and keeps provider controls out of prompt prose", () => {
    // Catches pending OCR or dated provider control syntax leaking into the prose prompt.
    const item = imageWithOcr({
      status: "needs-review",
      detectedText: "UNREVIEWED PRIVATE DRAFT",
      reviewedText: null,
      operationGeneration: 7,
      reviewRevision: 1,
    });

    const prompt = imagePromptProfile("google-nano-banana").promptBuilder(item);

    expect(prompt).toContain("No accepted reviewed OCR is supplied; preserve visible text by inspecting the source image.");
    expect(prompt).not.toContain("UNREVIEWED PRIVATE DRAFT");
    expect(prompt).not.toContain("Gemini 3.1 Flash Image");
    expect(prompt).not.toContain("Aspect ratio intent:");
  });

  it("defensively omits forged accepted OCR beyond 20,000 Unicode code points", () => {
    // Catches an imported or forged item bypassing reducer custody and leaking oversized OCR into a prompt.
    const sensitiveMarker = "PRIVATE-OCR-CONTENT";
    const item = imageWithOcr({
      status: "accepted",
      detectedText: null,
      reviewedText: sensitiveMarker.repeat(1_100),
      operationGeneration: 1,
      reviewRevision: 1,
    });

    const prompt = imagePromptProfile("openai-gpt-image").promptBuilder(item);

    expect(prompt).toContain(
      "No accepted reviewed OCR is supplied; preserve visible text by inspecting the source image.",
    );
    expect(prompt).not.toContain(sensitiveMarker);
  });

  it("keeps provider instructions in a separate dated run card", () => {
    // Catches current model metadata being baked into the family label or appended to prompt prose.
    const item = imageWithOcr({
      status: "off",
      detectedText: null,
      reviewedText: null,
      operationGeneration: 0,
      reviewRevision: 0,
    });
    const profile = imagePromptProfile("openai-gpt-image");

    expect(profile.runCardBuilder(item)).toBe([
      "# Provider run card",
      "",
      "- Family: OpenAI GPT Image",
      "- Reference model: gpt-image-2 edit",
      "- Profile version: 2026-08-14-v1",
      "- Last verified: 2026-08-14",
      "- Official guidance: https://developers.openai.com/api/docs/guides/image-generation",
      "- Source attachments: exactly one image",
      "- Prompt count: exactly one prompt",
      "- Aspect ratio intent: Match source",
      "- Size intent: Match source where supported",
      "- Visible text intent: Preserve",
      "- Background intent: Preserve source transparency/background behavior",
      "",
      "Use the provider's image-edit/reference workflow and attach the source image once. Paste the prompt separately. Provider controls and availability can change; map these intents only to controls currently offered in your account.",
    ].join("\n"));
    expect(profile.promptBuilder(item)).not.toContain("gpt-image-2");
  });

  it("states Midjourney variation limits and keeps Other/Custom provider-neutral", () => {
    // Catches unsupported precision controls being invented for families with looser semantics.
    const item = imageWithOcr({
      status: "off",
      detectedText: null,
      reviewedText: null,
      operationGeneration: 0,
      reviewRevision: 0,
    });

    expect(imagePromptProfile("midjourney").runCardBuilder(item)).toContain(
      "Best-effort variation: Image Prompts guide a new creation; they do not enforce an exact reconstruction.",
    );
    expect(imagePromptProfile("other-custom").runCardBuilder(item)).toContain(
      "Provider-neutral: No provider-specific controls are assumed or invented.",
    );
  });

  it("describes a Midjourney final image through one Image Prompt influence rather than a generic edit", () => {
    // Catches Midjourney receiving an edit-workflow instruction instead of truthful best-effort Image Prompt guidance.
    const item = imageWithOcr({
      status: "off",
      detectedText: null,
      reviewedText: null,
      operationGeneration: 0,
      reviewRevision: 0,
    });
    const profile = imagePromptProfile("midjourney");

    expect(profile.promptBuilder(item)).toBe([
      "Goal: Faithful rendition",
      "",
      "Use exactly one attached source image as an Image Prompt influence for one new creation.",
      "Generate the result from scratch as a new image; do not copy, duplicate, or merely return the unchanged source file.",
      "Describe and create the desired final image as a best-effort variation guided by the source, rather than issuing a precise edit instruction.",
      "Preserve the visible subject, composition, crop, framing, geometry, perspective, palette, lighting, texture, style, and typography as closely as the selected model supports.",
      "Apply only the explicit requested changes. Do not introduce unrelated changes.",
      "Requested changes: Change only the outer border to orange.",
      "Must preserve: Keep the centered badge and all line breaks.",
      "No accepted reviewed OCR is supplied; preserve visible text by inspecting the source image.",
      "Preserve the source transparency and background behavior as closely as supported.",
      "Review warning: Image generation is stochastic. Carefully compare faces, text, logos, geometry, and layout with the source before use.",
      "Usage guidance: Confirm you own or may use the source and generated result, and review the selected provider's current policies. This is informational, not legal advice.",
    ].join("\n"));

    const runCard = profile.runCardBuilder(item);
    expect(runCard).toContain("- Reference model: Midjourney V8.2");
    expect(runCard).toContain("- Workflow: Image Prompt influence for a new creation");
    expect(runCard).toContain("- Reference weight: Choose deliberately; it changes influence and does not guarantee fidelity");
    expect(runCard).toContain("Best-effort variation: Image Prompts guide a new creation; they do not enforce an exact reconstruction.");
    expect(runCard).not.toContain("image-edit/reference workflow");
    expect(profile.promptBuilder(item)).not.toContain("Midjourney V8.2");
  });
});
