import type {
  ImageAspectRatio,
  ImageModelFamilyId,
  ImagePortalItem,
  ImageSizeIntent,
} from "./contracts";
import { buildFaithfulImagePrompt, buildMidjourneyImagePrompt } from "./prompt";

export interface ImagePromptProfile {
  readonly id: ImageModelFamilyId;
  readonly label: string;
  readonly referenceModel: string;
  readonly profileVersion: string;
  readonly lastVerifiedAt: string;
  readonly officialSourceUrls: readonly string[];
  readonly capabilityNotes: readonly string[];
  readonly promptBuilder: (item: Readonly<ImagePortalItem>) => string;
  readonly runCardBuilder: (item: Readonly<ImagePortalItem>) => string;
}

const PROFILE_VERSION = "2026-08-14-v1";
const LAST_VERIFIED_AT = "2026-08-14";

const ASPECT_RATIO_LABELS: Readonly<Record<ImageAspectRatio, string>> = Object.freeze({
  "match-source": "Match source",
  "provider-default": "Provider default",
  "1:1": "1:1",
  "4:3": "4:3",
  "3:4": "3:4",
  "16:9": "16:9",
  "9:16": "9:16",
});

const SIZE_INTENT_LABELS: Readonly<Record<ImageSizeIntent, string>> = Object.freeze({
  "match-source-where-supported": "Match source where supported",
  "highest-practical-quality": "Highest practical quality",
});

interface ProfileDefinition {
  readonly id: ImageModelFamilyId;
  readonly label: string;
  readonly referenceModel: string;
  readonly officialSourceUrls: readonly string[];
  readonly capabilityNotes: readonly string[];
  readonly promptBuilder?: ImagePromptProfile["promptBuilder"];
  readonly runCardFields?: readonly string[];
  readonly runCardInstruction?: string;
  readonly runCardNote?: string;
}

function buildRunCard(definition: ProfileDefinition, item: Readonly<ImagePortalItem>): string {
  const officialGuidance = definition.officialSourceUrls.length > 0
    ? definition.officialSourceUrls.join(", ")
    : "No provider-specific source; follow the selected provider's current official documentation";
  return [
    "# Provider run card",
    "",
    `- Family: ${definition.label}`,
    `- Reference model: ${definition.referenceModel}`,
    `- Profile version: ${PROFILE_VERSION}`,
    `- Last verified: ${LAST_VERIFIED_AT}`,
    `- Official guidance: ${officialGuidance}`,
    "- Source attachments: exactly one image",
    "- Prompt count: exactly one prompt",
    `- Aspect ratio intent: ${ASPECT_RATIO_LABELS[item.settings.aspectRatio]}`,
    `- Size intent: ${SIZE_INTENT_LABELS[item.settings.sizeIntent]}`,
    `- Visible text intent: ${item.settings.preserveVisibleText ? "Preserve" : "Provider default"}`,
    `- Background intent: ${item.settings.backgroundBehavior === "preserve-source" ? "Preserve source transparency/background behavior" : "Provider default"}`,
    ...(definition.runCardFields ?? []),
    "",
    definition.runCardInstruction
      ?? "Use the provider's image-edit/reference workflow and attach the source image once. Paste the prompt separately. Provider controls and availability can change; map these intents only to controls currently offered in your account.",
    ...(definition.runCardNote ? ["", definition.runCardNote] : []),
  ].join("\n");
}

function profile(definition: ProfileDefinition): Readonly<ImagePromptProfile> {
  const frozenDefinition: ProfileDefinition = {
    ...definition,
    officialSourceUrls: Object.freeze([...definition.officialSourceUrls]),
    capabilityNotes: Object.freeze([...definition.capabilityNotes]),
  };
  return Object.freeze({
    id: frozenDefinition.id,
    label: frozenDefinition.label,
    referenceModel: frozenDefinition.referenceModel,
    profileVersion: PROFILE_VERSION,
    lastVerifiedAt: LAST_VERIFIED_AT,
    officialSourceUrls: frozenDefinition.officialSourceUrls,
    capabilityNotes: frozenDefinition.capabilityNotes,
    promptBuilder: frozenDefinition.promptBuilder ?? buildFaithfulImagePrompt,
    runCardBuilder: (item: Readonly<ImagePortalItem>) => buildRunCard(frozenDefinition, item),
  });
}

export const DEFAULT_IMAGE_PROMPT_PROFILE_ID: ImageModelFamilyId = "openai-gpt-image";

export const IMAGE_PROMPT_PROFILES: readonly Readonly<ImagePromptProfile>[] = Object.freeze([
  profile({
    id: "openai-gpt-image",
    label: "OpenAI GPT Image",
    referenceModel: "gpt-image-2 edit",
    officialSourceUrls: ["https://developers.openai.com/api/docs/guides/image-generation"],
    capabilityNotes: ["Use the current image edit/reference workflow; exact control availability can vary by account."],
  }),
  profile({
    id: "google-nano-banana",
    label: "Google Nano Banana",
    referenceModel: "Nano Banana 2 / Gemini 3.1 Flash Image",
    officialSourceUrls: ["https://ai.google.dev/gemini-api/docs/image-generation"],
    capabilityNotes: ["Use the current Gemini image generation/editing workflow with one source image."],
  }),
  profile({
    id: "xai-grok-imagine",
    label: "xAI Grok Imagine",
    referenceModel: "grok-imagine-image-2.0",
    officialSourceUrls: ["https://docs.x.ai/developers/model-capabilities/images/editing"],
    capabilityNotes: ["Use the current image editing workflow and treat shared settings as intents, not guaranteed controls."],
  }),
  profile({
    id: "bfl-flux",
    label: "Black Forest Labs FLUX",
    referenceModel: "FLUX.2",
    officialSourceUrls: ["https://docs.bfl.ai/flux_2/flux2_image_editing"],
    capabilityNotes: ["Use the current FLUX.2 image editing workflow and one source reference."],
  }),
  profile({
    id: "adobe-firefly",
    label: "Adobe Firefly",
    referenceModel: "Firefly Image 5",
    officialSourceUrls: ["https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/cm-generate-image/feature-guide"],
    capabilityNotes: ["Use currently documented composition/reference features only where the selected Firefly surface offers them."],
  }),
  profile({
    id: "ideogram",
    label: "Ideogram",
    referenceModel: "Ideogram 3.0",
    officialSourceUrls: ["https://docs.ideogram.ai/using-ideogram/features-and-tools/remix"],
    capabilityNotes: ["Use Ideogram 3.0 through the Remix workflow as a guided variation and verify visible text carefully."],
  }),
  profile({
    id: "midjourney",
    label: "Midjourney",
    referenceModel: "Midjourney V8.2",
    officialSourceUrls: ["https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts"],
    capabilityNotes: ["Image Prompts guide content, composition, and color as best-effort influence rather than exact reconstruction."],
    promptBuilder: buildMidjourneyImagePrompt,
    runCardFields: [
      "- Workflow: Image Prompt influence for a new creation",
      "- Reference weight: Choose deliberately; it changes influence and does not guarantee fidelity",
    ],
    runCardInstruction: "Use Midjourney's current Image Prompt workflow and attach the source image once. Paste the final-image description separately. Choose the currently available image/reference weight deliberately; it changes influence rather than guaranteeing fidelity.",
    runCardNote: "Best-effort variation: Image Prompts guide a new creation; they do not enforce an exact reconstruction.",
  }),
  profile({
    id: "stability-ai",
    label: "Stability AI",
    referenceModel: "Stable Image / SD3.5",
    officialSourceUrls: ["https://platform.stability.ai/docs/api-reference"],
    capabilityNotes: ["Select only controls exposed by the current Stable Image or SD3.5 workflow in use."],
  }),
  profile({
    id: "other-custom",
    label: "Other/Custom",
    referenceModel: "User-selected image model",
    officialSourceUrls: [],
    capabilityNotes: ["Provider-neutral profile with shared intents only and no assumed provider controls."],
    runCardNote: "Provider-neutral: No provider-specific controls are assumed or invented.",
  }),
]);

export function imagePromptProfile(id: ImageModelFamilyId): Readonly<ImagePromptProfile> {
  return IMAGE_PROMPT_PROFILES.find((candidate) => candidate.id === id)
    ?? IMAGE_PROMPT_PROFILES.find((candidate) => candidate.id === DEFAULT_IMAGE_PROMPT_PROFILE_ID)!;
}
