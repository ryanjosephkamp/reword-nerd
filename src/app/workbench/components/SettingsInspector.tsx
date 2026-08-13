import { useId, useRef, useState, type ReactNode } from "react";
import type { CodeRewriteOptions, ExtractionOptions, RewriteSettings, Tone, Formality, LengthPreference, OcrMode } from "../../../domain";
import { cloneExtractionOptions } from "../../../domain";
import { CURATED_MODEL_PROFILES, MAX_CUSTOM_REQUIREMENTS_LENGTH } from "../../../domain";
import type { WorkbenchState } from "../contracts";
import { selectEditableSettings } from "../selectors";
import {
  MAX_CUSTOM_PROFILE_LABEL_LENGTH,
  MAX_OUTPUT_LANGUAGE_LENGTH,
  canonicalPageSelection,
  parseContextLimitDraft,
  truncateUnicode,
} from "../preferences";
import {
  SettingsHelpField,
  SettingsHelpPopover,
  SettingsHelpTrigger,
  type ActiveSettingsHelp,
} from "./SettingsHelp";
import type { SettingsHelpKey } from "./settingsHelpContent";
import { useSettingsHelpContainment } from "./useSettingsHelpContainment";

interface SettingsInspectorProps {
  state: WorkbenchState;
  onGlobalChange(field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]): void;
  onOverrideEnabled(enabled: boolean): void;
  onOverrideChange(field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]): void;
  onProfileSelected(profileId: string): void;
  onProfileLabel(value: string): void;
  onContextDraft(value: string, parsed: number | null | undefined): void;
  onCodeRewriteOptionsChange(options: CodeRewriteOptions): void;
  onExtractionOptionsChange(options: ExtractionOptions, reprocess: boolean): void;
  onResetPreferences(returnFocus: HTMLButtonElement): void;
  exportPanel?: ReactNode;
}

const toneOptions: readonly Tone[] = ["preserve", "academic", "professional", "technical", "plain"];
const formalityOptions: readonly Formality[] = ["preserve", "standard", "formal"];
const lengthOptions: readonly LengthPreference[] = ["preserve", "concise", "expanded"];

function title(value: string): string {
  return value === "preserve" ? "Preserve source" : value[0].toUpperCase() + value.slice(1);
}

function PageSelectionInput({ value, id, errorId, onValidChange }: {
  value: ExtractionOptions["pageSelection"];
  id: string;
  errorId: string;
  onValidChange(value: ExtractionOptions["pageSelection"]): void;
}) {
  const [draft, setDraft] = useState(value);
  const canonical = canonicalPageSelection(draft);
  const invalid = canonical === undefined;
  return <>
    <input
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
      value={draft}
      placeholder="all or 1-3, 7"
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const nextCanonical = canonicalPageSelection(nextDraft);
        if (nextCanonical !== undefined) onValidChange(nextCanonical);
      }}
    />
    {invalid ? <p className="field-error" id={errorId}>Use all or positive ascending pages and ranges, such as 1-3, 7.</p> : null}
  </>;
}

export function SettingsInspector(props: SettingsInspectorProps) {
  const selected = props.state.documents.find((document) => document.id === props.state.selectedDocumentId);
  const override = selected ? props.state.overrideEnabled[selected.id] : false;
  const settings = selected ? selectEditableSettings(props.state, selected.id) : props.state.globalSettings;
  const [activeHelp, setActiveHelp] = useState<ActiveSettingsHelp | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const uniquePrefix = `settings-${useId().replaceAll(":", "")}`;
  const id = (name: string) => `${uniquePrefix}-${name}`;
  const tooltipId = (helpKey: SettingsHelpKey) => id(`help-${helpKey}`);
  const closeHelp = () => setActiveHelp(null);
  const previewHelp = (helpKey: SettingsHelpKey) => setActiveHelp((current) => current?.key === helpKey ? current : { key: helpKey, pinned: false });
  const pinHelp = (helpKey: SettingsHelpKey) => setActiveHelp((current) => current?.key === helpKey && current.pinned ? null : { key: helpKey, pinned: true });
  useSettingsHelpContainment(inspectorRef, closeHelp);
  const change = (field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]) => {
    if (selected && override) props.onOverrideChange(field, value);
    else props.onGlobalChange(field, value);
  };
  const contextDraft = props.state.customContextDraft;
  const parsedContext = parseContextLimitDraft(contextDraft);
  const invalidContext = parsedContext === undefined;
  const extraction = selected?.extractionOptions ?? props.state.globalExtractionOptions;
  const codeOptions = props.state.globalCodeRewriteOptions;
  const extractionChange = <K extends keyof ExtractionOptions>(field: K, value: ExtractionOptions[K]) => {
    props.onExtractionOptionsChange(cloneExtractionOptions({ ...extraction, [field]: value }), Boolean(selected));
  };
  const help = {
    active: activeHelp,
    getTooltipId: tooltipId,
    onPreview: previewHelp,
    onPin: pinHelp,
    onClose: closeHelp,
  };
  const showPageSelection = extraction.extractEmbeddedImages || extraction.capturePageVisuals || extraction.ocrMode !== "off";
  return <div className="settings-fields" ref={inspectorRef} onKeyDown={(event) => {
    if (event.key === "Escape" && activeHelp) {
      event.stopPropagation();
      closeHelp();
    }
  }}>
    {selected ? <SettingsHelpField label="PER-FILE OVERRIDE" htmlFor={id("per-file-override")} helpKey="perFileOverride" className="toggle-label" {...help}>
      <input id={id("per-file-override")} type="checkbox" role="switch" checked={override} onChange={(event) => props.onOverrideEnabled(event.currentTarget.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </SettingsHelpField> : <p className="global-settings-label">Global settings</p>}
    <SettingsHelpField label="Model profile" htmlFor={id("model-profile")} helpKey="modelProfile" {...help}>
      <select id={id("model-profile")} value={props.state.selectedProfileId} onChange={(event) => props.onProfileSelected(event.currentTarget.value)}>
        {CURATED_MODEL_PROFILES.map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}
      </select>
    </SettingsHelpField>
    {props.state.selectedProfileId === "custom" ? <SettingsHelpField label="Custom Model label" htmlFor={id("custom-model-label")} helpKey="customModelLabel" {...help}>
      <input
        id={id("custom-model-label")}
        required
        aria-invalid={!props.state.customProfileLabel.trim() || undefined}
        maxLength={MAX_CUSTOM_PROFILE_LABEL_LENGTH * 2}
        value={props.state.customProfileLabel}
        onChange={(event) => props.onProfileLabel(truncateUnicode(event.currentTarget.value, MAX_CUSTOM_PROFILE_LABEL_LENGTH))}
      />
    </SettingsHelpField> : null}
    {props.state.selectedProfileId === "custom" ? <p className="custom-profile-help">Use Custom model for local, self-hosted, fine-tuned, or otherwise unlisted models.</p> : null}
    <SettingsHelpField label="Context limit" htmlFor={id("context-limit")} helpKey="contextLimit" {...help}>
      <input
        id={id("context-limit")}
        inputMode="numeric"
        aria-invalid={invalidContext || undefined}
        aria-describedby={invalidContext ? id("context-limit-error") : undefined}
        value={contextDraft}
        placeholder="Unknown"
        onChange={(event) => {
          const value = event.currentTarget.value;
          props.onContextDraft(value, parseContextLimitDraft(value));
        }}
      />
      {invalidContext ? <p className="field-error" id={id("context-limit-error")}>Context limit must be a positive whole number or unknown.</p> : null}
    </SettingsHelpField>
    <SettingsHelpField label="Tone" htmlFor={id("tone")} helpKey="tone" {...help}>
      <select id={id("tone")} value={settings.tone} onChange={(event) => change("tone", event.currentTarget.value as Tone)}>
        {toneOptions.map((value) => <option value={value} key={value}>{title(value)}</option>)}
      </select>
    </SettingsHelpField>
    <SettingsHelpField label="Formality" htmlFor={id("formality")} helpKey="formality" {...help}>
      <select id={id("formality")} value={settings.formality} onChange={(event) => change("formality", event.currentTarget.value as Formality)}>
        {formalityOptions.map((value) => <option value={value} key={value}>{title(value)}</option>)}
      </select>
    </SettingsHelpField>
    <SettingsHelpField label="Length" htmlFor={id("length")} helpKey="length" {...help}>
      <select id={id("length")} value={settings.length} onChange={(event) => change("length", event.currentTarget.value as LengthPreference)}>
        {lengthOptions.map((value) => <option value={value} key={value}>{title(value)}</option>)}
      </select>
    </SettingsHelpField>
    <SettingsHelpField label="Output language" htmlFor={id("output-language")} helpKey="outputLanguage" {...help}>
      <input
        id={id("output-language")}
        required
        aria-invalid={!settings.outputLanguage.trim() || undefined}
        maxLength={MAX_OUTPUT_LANGUAGE_LENGTH * 2}
        value={settings.outputLanguage}
        onChange={(event) => change("outputLanguage", truncateUnicode(event.currentTarget.value, MAX_OUTPUT_LANGUAGE_LENGTH))}
      />
    </SettingsHelpField>
    <SettingsHelpField label="Custom requirements" htmlFor={id("custom-requirements")} helpKey="customRequirements" {...help}>
      <textarea
        id={id("custom-requirements")}
        value={settings.customRequirements}
        maxLength={MAX_CUSTOM_REQUIREMENTS_LENGTH * 2}
        onChange={(event) => change("customRequirements", Array.from(event.currentTarget.value).slice(0, MAX_CUSTOM_REQUIREMENTS_LENGTH).join(""))}
      />
    </SettingsHelpField>
    <fieldset className="processing-settings" aria-labelledby={id("code-rewrite-title")}>
      <legend id={id("code-rewrite-title")}>CODE &amp; STRUCTURED TEXT</legend>
      <p className="processing-help">Choose which prose-like regions may be rewritten. Executable syntax and structural tokens always stay protected.</p>
      {([
        ["documentationAndMarkup", "Rewrite documentation and markup", "documentationAndMarkup"],
        ["commentsAndDocstrings", "Rewrite comments and docstrings", "commentsAndDocstrings"],
        ["userFacingStrings", "Rewrite user-facing strings", "userFacingStrings"],
        ["narrativeStructuredDataValues", "Rewrite narrative structured-data values", "narrativeStructuredDataValues"],
        ["honorRootGitignore", "Honor root .gitignore", "honorRootGitignore"],
        ["excludeDependenciesBuildGenerated", "Exclude dependencies, build, and generated content", "excludeDependenciesBuildGenerated"],
        ["preserveSafeNonTextAssets", "Preserve safe non-text assets", "preserveSafeNonTextAssets"],
      ] as const).map(([field, label, helpKey]) => <SettingsHelpField key={field} label={label} htmlFor={id(field)} helpKey={helpKey} className="checkbox-row" {...help}>
        <input id={id(field)} type="checkbox" checked={codeOptions[field]} onChange={(event) => props.onCodeRewriteOptionsChange({ ...codeOptions, [field]: event.currentTarget.checked, protectedExecutableSyntax: true })} />
      </SettingsHelpField>)}
      <SettingsHelpField label="Preserve executable syntax" htmlFor={id("protected-executable-syntax")} helpKey="protectedExecutableSyntax" className="checkbox-row" {...help}>
        <input id={id("protected-executable-syntax")} type="checkbox" checked disabled />
      </SettingsHelpField>
    </fieldset>
    <fieldset className="processing-settings" aria-labelledby={id("document-processing-title")}>
      <legend>
        <span className="settings-help-legend-row">
          <span id={id("document-processing-title")}>DOCUMENT PROCESSING</span>
          <SettingsHelpTrigger helpKey="documentProcessing" label="Document processing" tooltipId={tooltipId("documentProcessing")} {...help} />
        </span>
      </legend>
      {activeHelp?.key === "documentProcessing" ? <SettingsHelpPopover helpKey="documentProcessing" label="Document processing" pinned={activeHelp.pinned} tooltipId={tooltipId("documentProcessing")} onClose={closeHelp} onMouseEnter={() => previewHelp("documentProcessing")} onMouseLeave={() => { if (!activeHelp.pinned) closeHelp(); }} /> : null}
      <p className="processing-help">Embedded images are extracted by default. PDF page capture and OCR stay off until enabled. Changes to an uploaded file reprocess it locally.</p>
      <SettingsHelpField label="Extract embedded images" htmlFor={id("extract-embedded-images")} helpKey="extractEmbeddedImages" className="checkbox-row" {...help}>
        <input id={id("extract-embedded-images")} type="checkbox" checked={extraction.extractEmbeddedImages} onChange={(event) => extractionChange("extractEmbeddedImages", event.currentTarget.checked)} />
      </SettingsHelpField>
      <SettingsHelpField label="Capture PDF page visuals" htmlFor={id("capture-pdf-page-visuals")} helpKey="capturePdfPageVisuals" className="checkbox-row" {...help}>
        <input id={id("capture-pdf-page-visuals")} type="checkbox" checked={extraction.capturePageVisuals} onChange={(event) => extractionChange("capturePageVisuals", event.currentTarget.checked)} />
      </SettingsHelpField>
      {showPageSelection ? <SettingsHelpField label="PDF pages" htmlFor={id("pdf-pages")} helpKey="pdfPages" {...help}>
        <PageSelectionInput
          key={`${selected?.id ?? "global"}:${extraction.pageSelection}`}
          id={id("pdf-pages")}
          errorId={id("page-selection-error")}
          value={extraction.pageSelection}
          onValidChange={(value) => extractionChange("pageSelection", value)}
        />
      </SettingsHelpField> : null}
      {extraction.capturePageVisuals ? <SettingsHelpField label="Page visual quality" htmlFor={id("page-visual-quality")} helpKey="pageVisualQuality" {...help}>
        <select id={id("page-visual-quality")} value={extraction.pageCaptureQuality} onChange={(event) => extractionChange("pageCaptureQuality", event.currentTarget.value as ExtractionOptions["pageCaptureQuality"])}>
          <option value="standard">Standard (conservative)</option>
          <option value="high">High</option>
        </select>
      </SettingsHelpField> : null}
      <SettingsHelpField label="OCR" htmlFor={id("ocr")} helpKey="ocr" {...help}>
        <select id={id("ocr")} value={extraction.ocrMode} onChange={(event) => extractionChange("ocrMode", event.currentTarget.value as OcrMode)}>
          <option value="off">Off</option>
          <option value="textless-pages">Textless PDF pages</option>
          <option value="all-pages">All selected PDF pages</option>
        </select>
      </SettingsHelpField>
      <SettingsHelpField label="OCR extracted raster images" htmlFor={id("ocr-extracted-raster-images")} helpKey="ocrExtractedRasterImages" className="checkbox-row" {...help}>
        <input id={id("ocr-extracted-raster-images")} type="checkbox" checked={extraction.ocrExtractedAssets} disabled={!extraction.extractEmbeddedImages} onChange={(event) => extractionChange("ocrExtractedAssets", event.currentTarget.checked)} />
      </SettingsHelpField>
      <SettingsHelpField label="Exclude likely decorative images" htmlFor={id("exclude-likely-decorative-images")} helpKey="excludeLikelyDecorativeImages" className="checkbox-row" {...help}>
        <input id={id("exclude-likely-decorative-images")} type="checkbox" checked={extraction.excludeDecorativeImages} onChange={(event) => extractionChange("excludeDecorativeImages", event.currentTarget.checked)} />
      </SettingsHelpField>
      <p className="processing-help">OCR uses bundled English locally, is capped at 150 pages or images, and always requires review before export.</p>
    </fieldset>
    <button type="button" className="reset-preferences-button" onClick={(event) => props.onResetPreferences(event.currentTarget)}>Reset saved preferences</button>
    {props.exportPanel}
  </div>;
}
