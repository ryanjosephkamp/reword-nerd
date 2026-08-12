export type DemoVideoId = "overview" | "settings" | "review" | "package";

interface DemoDefinition {
  title: string;
  accessibleLabel: string;
  posterAlt: string;
  transcript: readonly string[];
}

export const DEMO_DEFINITIONS: Readonly<Record<DemoVideoId, DemoDefinition>> = {
  overview: {
    title: "How reword_nerd works",
    accessibleLabel: "reword_nerd overview demonstration",
    posterAlt: "reword_nerd overview demonstration poster",
    transcript: [
      "Choose the model profile and rewrite settings that match the chat interface you plan to use.",
      "Add a supported document. Extraction and optional image or OCR processing happen locally in the browser.",
      "Review the extracted text and visual assets, then confirm the document.",
      "Build the package and choose the Runbook, One-shot, or Manual workflow.",
      "Copy prompts into your selected model, or download the ZIP and continue from the standalone workbook.",
    ],
  },
  settings: {
    title: "Choose settings",
    accessibleLabel: "Settings demonstration",
    posterAlt: "Settings demonstration poster",
    transcript: [
      "Select the model profile so generated prompts use provider-specific guidance where applicable.",
      "Context limit powers the package-size warning for both One-shot and Manual workflows.",
      "Choose tone, formality, length, output language, and optional custom requirements.",
      "Document processing remains conservative: embedded-image extraction is on, while page captures and OCR are opt-in.",
    ],
  },
  review: {
    title: "Review a document",
    accessibleLabel: "Review demonstration",
    posterAlt: "Review demonstration poster",
    transcript: [
      "Open the extracted source and correct anything that needs attention.",
      "Inspect extracted figures in Assets and decide which ones belong in the package.",
      "Review every OCR candidate when OCR is enabled.",
      "Confirm review only after the text and assets accurately represent the source.",
    ],
  },
  package: {
    title: "Build and use a package",
    accessibleLabel: "Package demonstration",
    posterAlt: "Package demonstration poster",
    transcript: [
      "Build Package creates an immutable local preview; it does not download automatically.",
      "Read the Runbook first, then choose One-shot for the compact workflow or Manual for four inspectable stages.",
      "Copy the active prompt and paste model responses into the matching response fields.",
      "Download a progress copy or the complete ZIP when you are ready to keep the work outside this session.",
    ],
  },
};

export function resolveDemoAssetPath(filename: string, baseUrl = import.meta.env.BASE_URL): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}media/demo/${filename}`;
}
