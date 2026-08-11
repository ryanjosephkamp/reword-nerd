import type { RewriteSettings, Tone, Formality, LengthPreference } from "../../../domain";
import { CURATED_MODEL_PROFILES, MAX_CUSTOM_REQUIREMENTS_LENGTH } from "../../../domain";
import type { WorkbenchState } from "../contracts";
import { selectEditableSettings } from "../selectors";

interface SettingsInspectorProps {
  state: WorkbenchState;
  onGlobalChange(field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]): void;
  onOverrideEnabled(enabled: boolean): void;
  onOverrideChange(field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]): void;
  onProfileSelected(profileId: string): void;
  onProfileLabel(value: string): void;
  onContextDraft(value: string, parsed: number | null): void;
  exportPanel?: React.ReactNode;
}

const toneOptions: readonly Tone[] = ["preserve", "academic", "professional", "technical", "plain"];
const formalityOptions: readonly Formality[] = ["preserve", "standard", "formal"];
const lengthOptions: readonly LengthPreference[] = ["preserve", "concise", "expanded"];

function title(value: string): string {
  return value === "preserve" ? "Preserve source" : value[0].toUpperCase() + value.slice(1);
}

export function SettingsInspector(props: SettingsInspectorProps) {
  const selected = props.state.documents.find((document) => document.id === props.state.selectedDocumentId);
  const override = selected ? props.state.overrideEnabled[selected.id] : false;
  const settings = selected ? selectEditableSettings(props.state, selected.id) : props.state.globalSettings;
  const change = (field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]) => {
    if (selected && override) props.onOverrideChange(field, value);
    else props.onGlobalChange(field, value);
  };
  const contextDraft = props.state.customContextDraft || props.state.workingProfile.contextWindowTokens?.toString() || "";
  const invalidContext = contextDraft !== "" && (!/^\d+$/.test(contextDraft) || Number(contextDraft) <= 0);
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
      <input required value={props.state.customProfileLabel} onChange={(event) => props.onProfileLabel(event.currentTarget.value)} />
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
          props.onContextDraft(value, value === "" || !/^\d+$/.test(value) ? null : Number(value));
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
      <input required value={settings.outputLanguage} onChange={(event) => change("outputLanguage", event.currentTarget.value)} />
    </label>
    <label>Custom requirements
      <textarea
        value={settings.customRequirements}
        maxLength={MAX_CUSTOM_REQUIREMENTS_LENGTH * 2}
        onChange={(event) => change("customRequirements", Array.from(event.currentTarget.value).slice(0, MAX_CUSTOM_REQUIREMENTS_LENGTH).join(""))}
      />
    </label>
    {props.exportPanel}
  </div>;
}
