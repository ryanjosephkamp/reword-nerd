export type SettingsHelpKey =
  | "perFileOverride"
  | "modelProfile"
  | "customModelLabel"
  | "contextLimit"
  | "tone"
  | "formality"
  | "length"
  | "outputLanguage"
  | "customRequirements"
  | "documentProcessing"
  | "extractEmbeddedImages"
  | "capturePdfPageVisuals"
  | "pdfPages"
  | "pageVisualQuality"
  | "ocr"
  | "ocrExtractedRasterImages"
  | "excludeLikelyDecorativeImages"
  | "documentationAndMarkup"
  | "commentsAndDocstrings"
  | "userFacingStrings"
  | "narrativeStructuredDataValues"
  | "honorRootGitignore"
  | "excludeDependenciesBuildGenerated"
  | "preserveSafeNonTextAssets"
  | "protectedExecutableSyntax";

export const SETTINGS_HELP_CONTENT: Record<SettingsHelpKey, string> = {
  perFileOverride: "Uses document-specific tone, formality, length, output language, and requirements instead of global values. It does not change the model profile or context limit.",
  modelProfile: "Applies dated prompt-structure guidance for the chosen model family because models are not all prompted identically. It never contacts the provider.",
  customModelLabel: "Names a local, self-hosted, fine-tuned, or otherwise unlisted Custom model in package metadata.",
  contextLimit: "Drives One-shot and Manual size estimates and warnings. Match the exact model and interface you will use, or leave it unknown.",
  tone: "Choose Preserve source, Academic, Professional, Technical, or Plain voice.",
  formality: "Choose Preserve source, Standard, or Formal register.",
  length: "Preserve the source length, make the rewrite more concise, or expand it.",
  outputLanguage: "Requests the final language. Preserve source language retains the original language.",
  customRequirements: "Adds extra citation, terminology, structure, or formatting constraints verbatim to generated prompts, up to 2,000 code points.",
  documentProcessing: "Controls local extraction. Changing it for an uploaded document reprocesses that document.",
  extractEmbeddedImages: "Recovers supported figures and media from PDF, DOCX, Markdown, and LaTeX, then packages the assets selected during review.",
  capturePdfPageVisuals: "Renders selected pages as images when layout or composite figures cannot be recovered separately. This increases processing and package size.",
  pdfPages: "Restricts page-based extraction, capture, and OCR to all pages or selected ranges.",
  pageVisualQuality: "Standard is smaller and faster. High is sharper but larger.",
  ocr: "Choose Off, textless selected PDF pages, or all selected pages. Bundled English OCR runs locally and requires review.",
  ocrExtractedRasterImages: "Also runs OCR over recovered raster assets. It is available only when embedded-image extraction is enabled.",
  excludeLikelyDecorativeImages: "Applies conservative size and type heuristics, not semantic classification. Verify exclusions in Assets.",
  documentationAndMarkup: "Includes prose in documentation and markup while preserving tags, attributes, links, and structure.",
  commentsAndDocstrings: "Includes comments and docstrings for rewriting while keeping surrounding executable syntax unchanged.",
  userFacingStrings: "Includes strings shown to users. Identifiers, protocol values, placeholders, and other executable strings stay protected.",
  narrativeStructuredDataValues: "Includes prose-like values in JSON, YAML, TOML, INI, and config files. Keys, types, numbers, and structure stay protected.",
  honorRootGitignore: "Applies the project root .gitignore locally when deciding initial exclusions. No files or patterns leave this browser.",
  excludeDependenciesBuildGenerated: "Excludes dependencies, vendor, cache, build, generated, minified, source-map, and lock content by default.",
  preserveSafeNonTextAssets: "Keeps safe non-text assets in the sanitized project package without placing their bytes in prompts.",
  protectedExecutableSyntax: "Always on. Preserves executable syntax, control flow, identifiers, imports, signatures, paths, and structural tokens.",
};
