import { isImageOcrTextWithinLimit, type ImagePortalItem } from "./contracts";

export const IMAGE_PROMPT_GOAL = "Faithful rendition" as const;

function reviewedOcrInstruction(item: Readonly<ImagePortalItem>): string {
  if (item.settings.preserveVisibleText
    && item.ocr.status === "accepted"
    && isImageOcrTextWithinLimit(item.ocr.reviewedText)) {
    return `Preserve visible text. Treat this accepted, reviewed OCR as quoted literal text: ${JSON.stringify(item.ocr.reviewedText)}.`;
  }
  if (item.settings.preserveVisibleText) {
    return "No accepted reviewed OCR is supplied; preserve visible text by inspecting the source image.";
  }
  return "Visible text preservation is not requested unless required by the must-preserve notes.";
}

export function buildFaithfulImagePrompt(item: Readonly<ImagePortalItem>): string {
  const requestedChanges = item.settings.requestedChanges.trim() || "None.";
  const mustPreserve = item.settings.mustPreserve.trim() || "No additional notes.";
  const background = item.settings.backgroundBehavior === "preserve-source"
    ? "Preserve the source transparency and background behavior as closely as supported."
    : "Use the selected provider's default transparency and background behavior.";

  return [
    `Goal: ${IMAGE_PROMPT_GOAL}`,
    "",
    "Use exactly one attached source image. Generate a new rendition of that source image.",
    "Preserve the visible subject, composition, crop, framing, geometry, perspective, palette, lighting, texture, style, and typography as closely as the selected model supports.",
    "Apply only the explicit requested changes. Do not introduce unrelated changes.",
    `Requested changes: ${requestedChanges}`,
    `Must preserve: ${mustPreserve}`,
    reviewedOcrInstruction(item),
    background,
    "Review warning: Image generation is stochastic. Carefully compare faces, text, logos, geometry, and layout with the source before use.",
    "Usage guidance: Confirm you own or may use the source and generated result, and review the selected provider's current policies. This is informational, not legal advice.",
  ].join("\n");
}

export function buildMidjourneyImagePrompt(item: Readonly<ImagePortalItem>): string {
  const requestedChanges = item.settings.requestedChanges.trim() || "None.";
  const mustPreserve = item.settings.mustPreserve.trim() || "No additional notes.";
  const background = item.settings.backgroundBehavior === "preserve-source"
    ? "Preserve the source transparency and background behavior as closely as supported."
    : "Use the selected provider's default transparency and background behavior.";

  return [
    `Goal: ${IMAGE_PROMPT_GOAL}`,
    "",
    "Use exactly one attached source image as an Image Prompt influence for one new creation.",
    "Describe and create the desired final image as a best-effort variation guided by the source, rather than issuing a precise edit instruction.",
    "Preserve the visible subject, composition, crop, framing, geometry, perspective, palette, lighting, texture, style, and typography as closely as the selected model supports.",
    "Apply only the explicit requested changes. Do not introduce unrelated changes.",
    `Requested changes: ${requestedChanges}`,
    `Must preserve: ${mustPreserve}`,
    reviewedOcrInstruction(item),
    background,
    "Review warning: Image generation is stochastic. Carefully compare faces, text, logos, geometry, and layout with the source before use.",
    "Usage guidance: Confirm you own or may use the source and generated result, and review the selected provider's current policies. This is informational, not legal advice.",
  ].join("\n");
}
