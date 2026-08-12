import { useState } from "react";
import type { ExtractionOptions, RewriteSettings, Tone, Formality, LengthPreference, OcrMode } from "../../../domain";
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

interface SettingsInspectorProps {
  state: WorkbenchState;
  onGlobalChange(field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]): void;
  onOverrideEnabled(enabled: boolean): void;
  onOverrideChange(field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]): void;
  onProfileSelected(profileId: string): void;
  onProfileLabel(value: string): void;
  onContextDraft(value: string, parsed: number | null | undefined): void;
  onExtractionOptionsChange(options: ExtractionOptions, reprocess: boolean): void;
  onResetPreferences(returnFocus: HTMLButtonElement): void;
  exportPanel?: React.ReactNode;
}

const toneOptions: readonly Tone[] = ["preserve", "academic", "professional", "technical", "plain"];
const formalityOptions: readonly Formality[] = ["preserve", "standard", "formal"];
const lengthOptions: readonly LengthPreference[] = ["preserve", "concise", "expanded"];

function title(value: string): string {
  return value === "preserve" ? "Preserve source" : value[0].toUpperCase() + value.slice(1);
}

function PageSelectionInput({ value, onValidChange }: {
  value: ExtractionOptions["pageSelection"];
  onValidChange(value: ExtractionOptions["pageSelection"]): void;
}) {
  const [draft, setDraft] = useState(value);
  const canonical = canonicalPageSelection(draft);
  const invalid = canonical === undefined;
  return <>
    <label>PDF pages
      <input
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? "page-selection-error" : undefined}
        value={draft}
        placeholder="all or 1-3, 7"
        onChange={(event) => {
          const nextDraft = event.currentTarget.value;
          setDraft(nextDraft);
          const nextCanonical = canonicalPageSelection(nextDraft);
          if (nextCanonical !== undefined) onValidChange(nextCanonical);
        }}
      />
    </label>
    {invalid ? <p className="field-error" id="page-selection-error">Use all or positive ascending pages and ranges, such as 1-3, 7.</p> : null}
  </>;
}

export function SettingsInspector(props: SettingsInspectorProps) {
  const selected = props.state.documents.find((document) => document.id === props.state.selectedDocumentId);
  const override = selected ? props.state.overrideEnabled[selected.id] : false;
  const settings = selected ? selectEditableSettings(props.state, selected.id) : props.state.globalSettings;
  const change = (field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]) => {
    if (selected && override) props.onOverrideChange(field, value);
    else props.onGlobalChange(field, value);
  };
  const contextDraft = props.state.customContextDraft;
  const parsedContext = parseContextLimitDraft(contextDraft);
  const invalidContext = parsedContext === undefined;
  const extraction = selected?.extractionOptions ?? props.state.globalExtractionOptions;
  const extractionChange = <K extends keyof ExtractionOptions>(field: K, value: ExtractionOptions[K]) => {
    props.onExtractionOptionsChange(cloneExtractionOptions({ ...extraction, [field]: value }), Boolean(selected));
  };
  return <div className="settings-fields">
    {selected ? <label className="toggle-label">PER-FILE OVERRIDE
      <input type="checkbox" role="switch" checked={override} onChange={(event) => props.onOverrideEnabled(event.currentTarget.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </label> : <p className="global-settings-label">Global settings</p>}
    <label>Model profile
      <select value={props.state.selectedProfileId} onChange={(event) => props.onProfileSelected(event.currentTarget.value)}>
        {CURATED_MODEL_PROFILES.map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}
      </select>
    </label>
    {props.state.selectedProfileId === "custom" ? <label>Model label
      <input
        required
        aria-invalid={!props.state.customProfileLabel.trim() || undefined}
        maxLength={MAX_CUSTOM_PROFILE_LABEL_LENGTH * 2}
        value={props.state.customProfileLabel}
        onChange={(event) => props.onProfileLabel(truncateUnicode(event.currentTarget.value, MAX_CUSTOM_PROFILE_LABEL_LENGTH))}
      />
    </label> : null}
    {props.state.selectedProfileId === "custom" ? <p className="custom-profile-help">
      Use Custom model for local, self-hosted, fine-tuned, or otherwise unlisted models.
    </p> : null}
    <label>Context limit
      <input
        inputMode="numeric"
        aria-invalid={invalidContext || undefined}
        aria-describedby={invalidContext ? "context-limit-error" : undefined}
        value={contextDraft}
        placeholder="Unknown"
        onChange={(event) => {
          const value = event.currentTarget.value;
          props.onContextDraft(value, parseContextLimitDraft(value));
        }}
      />
    </label>
    {invalidContext ? <p className="field-error" id="context-limit-error">Context limit must be a positive whole number or unknown.</p> : null}
    <label>Tone
      <select value={settings.tone} onChange={(event) => change("tone", event.currentTarget.value as Tone)}>
        {toneOptions.map((value) => <option value={value} key={value}>{title(value)}</option>)}
      </select>
    </label>
    <label>Formality
      <select value={settings.formality} onChange={(event) => change("formality", event.currentTarget.value as Formality)}>
        {formalityOptions.map((value) => <option value={value} key={value}>{title(value)}</option>)}
      </select>
    </label>
    <label>Length
      <select value={settings.length} onChange={(event) => change("length", event.currentTarget.value as LengthPreference)}>
        {lengthOptions.map((value) => <option value={value} key={value}>{title(value)}</option>)}
      </select>
    </label>
    <label>Output language
      <input
        required
        aria-invalid={!settings.outputLanguage.trim() || undefined}
        maxLength={MAX_OUTPUT_LANGUAGE_LENGTH * 2}
        value={settings.outputLanguage}
        onChange={(event) => change("outputLanguage", truncateUnicode(event.currentTarget.value, MAX_OUTPUT_LANGUAGE_LENGTH))}
      />
    </label>
    <label>Custom requirements
      <textarea
        value={settings.customRequirements}
        maxLength={MAX_CUSTOM_REQUIREMENTS_LENGTH * 2}
        onChange={(event) => change("customRequirements", Array.from(event.currentTarget.value).slice(0, MAX_CUSTOM_REQUIREMENTS_LENGTH).join(""))}
      />
    </label>
    <fieldset className="processing-settings">
      <legend>DOCUMENT PROCESSING</legend>
      <p className="processing-help">Embedded images are extracted by default. PDF page capture and OCR stay off until enabled. Changes to an uploaded file reprocess it locally.</p>
      <label className="checkbox-row">
        <input type="checkbox" checked={extraction.extractEmbeddedImages} onChange={(event) => extractionChange("extractEmbeddedImages", event.currentTarget.checked)} />
        Extract embedded images
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={extraction.capturePageVisuals} onChange={(event) => extractionChange("capturePageVisuals", event.currentTarget.checked)} />
        Capture PDF page visuals
      </label>
      {(extraction.extractEmbeddedImages || extraction.capturePageVisuals || extraction.ocrMode !== "off") ? <>
        <PageSelectionInput
          key={`${selected?.id ?? "global"}:${extraction.pageSelection}`}
          value={extraction.pageSelection}
          onValidChange={(value) => extractionChange("pageSelection", value)}
        />
      </> : null}
      {extraction.capturePageVisuals ? <label>Page visual quality
        <select value={extraction.pageCaptureQuality} onChange={(event) => extractionChange("pageCaptureQuality", event.currentTarget.value as ExtractionOptions["pageCaptureQuality"])}>
          <option value="standard">Standard (conservative)</option>
          <option value="high">High</option>
        </select>
      </label> : null}
      <label>OCR
        <select value={extraction.ocrMode} onChange={(event) => extractionChange("ocrMode", event.currentTarget.value as OcrMode)}>
          <option value="off">Off</option>
          <option value="textless-pages">Textless PDF pages</option>
          <option value="all-pages">All selected PDF pages</option>
        </select>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={extraction.ocrExtractedAssets} disabled={!extraction.extractEmbeddedImages} onChange={(event) => extractionChange("ocrExtractedAssets", event.currentTarget.checked)} />
        OCR extracted raster images
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={extraction.excludeDecorativeImages} onChange={(event) => extractionChange("excludeDecorativeImages", event.currentTarget.checked)} />
        Exclude likely decorative images
      </label>
      <p className="processing-help">OCR uses bundled English locally, is capped at 150 pages or images, and always requires review before export.</p>
    </fieldset>
    <button type="button" className="reset-preferences-button" onClick={(event) => props.onResetPreferences(event.currentTarget)}>Reset saved preferences</button>
    {props.exportPanel}
  </div>;
}
