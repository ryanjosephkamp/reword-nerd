import {
  isImagePromptSettingValue,
  type ImagePromptSettings,
} from "../contracts";
import { IMAGE_PROMPT_PROFILES, imagePromptProfile } from "../profiles";
import type { ImageSettingField } from "../reducer";

const FIELD_LABELS: Readonly<Record<ImageSettingField, string>> = {
  modelFamily: "Model family",
  aspectRatio: "Aspect ratio",
  sizeIntent: "Size intent",
  preserveVisibleText: "Visible text",
  backgroundBehavior: "Background",
  requestedChanges: "Requested changes",
  mustPreserve: "Must preserve",
};

const ASPECT_OPTIONS = [
  ["match-source", "Match source"],
  ["provider-default", "Provider default"],
  ["1:1", "1:1"],
  ["4:3", "4:3"],
  ["3:4", "3:4"],
  ["16:9", "16:9"],
  ["9:16", "9:16"],
] as const;

const SIZE_OPTIONS = [
  ["match-source-where-supported", "Match source where supported"],
  ["highest-practical-quality", "Highest practical quality"],
] as const;

const BACKGROUND_OPTIONS = [
  ["preserve-source", "Preserve source"],
  ["provider-default", "Provider default"],
] as const;

function SelectField({
  label,
  field,
  value,
  mixed,
  options,
  onChange,
}: {
  label: string;
  field: ImageSettingField;
  value: string;
  mixed: boolean;
  options: readonly (readonly [string, string])[];
  onChange(field: ImageSettingField, value: unknown): void;
}) {
  return <label>{label}
    <select aria-label={label} value={value} onChange={(event) => onChange(field, event.target.value)}>
      {mixed ? <option value="">Mixed — choose a value</option> : null}
      {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
    </select>
  </label>;
}

export function ImageSettingsFields({
  prefix,
  settings,
  mixedFields = new Set<ImageSettingField>(),
  masks,
  onMaskChange,
  onChange,
}: {
  prefix: "Default" | "Selected" | "Focused";
  settings: Partial<ImagePromptSettings>;
  mixedFields?: ReadonlySet<ImageSettingField>;
  masks?: Readonly<Record<ImageSettingField, boolean>>;
  onMaskChange?(field: ImageSettingField, checked: boolean): void;
  onChange(field: ImageSettingField, value: unknown): void;
}) {
  const label = (field: ImageSettingField) => `${prefix} ${FIELD_LABELS[field].toLowerCase()}`;
  const selectedProfile = isImagePromptSettingValue("modelFamily", settings.modelFamily)
    ? imagePromptProfile(settings.modelFamily)
    : null;
  const wrap = (field: ImageSettingField, control: React.ReactNode) => <div className="image-setting-field" key={field}>
    {masks ? <label className="image-field-mask">
      <input
        type="checkbox"
        aria-label={`Apply ${FIELD_LABELS[field]}`}
        checked={masks[field]}
        onChange={(event) => onMaskChange?.(field, event.target.checked)}
      /> APPLY
    </label> : null}
    {control}
  </div>;
  return <div className="image-settings-fields">
    {wrap("modelFamily", <SelectField
      label={label("modelFamily")}
      field="modelFamily"
      value={typeof settings.modelFamily === "string" ? settings.modelFamily : ""}
      mixed={mixedFields.has("modelFamily")}
      options={IMAGE_PROMPT_PROFILES.map((profile) => [profile.id, profile.label] as const)}
      onChange={onChange}
    />)}
    {wrap("aspectRatio", <SelectField
      label={label("aspectRatio")}
      field="aspectRatio"
      value={typeof settings.aspectRatio === "string" ? settings.aspectRatio : ""}
      mixed={mixedFields.has("aspectRatio")}
      options={ASPECT_OPTIONS}
      onChange={onChange}
    />)}
    {wrap("sizeIntent", <SelectField
      label={label("sizeIntent")}
      field="sizeIntent"
      value={typeof settings.sizeIntent === "string" ? settings.sizeIntent : ""}
      mixed={mixedFields.has("sizeIntent")}
      options={SIZE_OPTIONS}
      onChange={onChange}
    />)}
    {wrap("preserveVisibleText", <SelectField
      label={label("preserveVisibleText")}
      field="preserveVisibleText"
      value={typeof settings.preserveVisibleText === "boolean" ? String(settings.preserveVisibleText) : ""}
      mixed={mixedFields.has("preserveVisibleText")}
      options={[["true", "Preserve"], ["false", "Provider default"]]}
      onChange={(field, value) => onChange(field, value === "true" ? true : value === "false" ? false : value)}
    />)}
    {wrap("backgroundBehavior", <SelectField
      label={label("backgroundBehavior")}
      field="backgroundBehavior"
      value={typeof settings.backgroundBehavior === "string" ? settings.backgroundBehavior : ""}
      mixed={mixedFields.has("backgroundBehavior")}
      options={BACKGROUND_OPTIONS}
      onChange={onChange}
    />)}
    {wrap("requestedChanges", <label>{label("requestedChanges")}
      <textarea
        aria-label={label("requestedChanges")}
        placeholder={mixedFields.has("requestedChanges") ? "Mixed — choose a value" : undefined}
        value={settings.requestedChanges ?? ""}
        onChange={(event) => onChange("requestedChanges", event.target.value)}
      />
    </label>)}
    {wrap("mustPreserve", <label>{label("mustPreserve")}
      <textarea
        aria-label={label("mustPreserve")}
        placeholder={mixedFields.has("mustPreserve") ? "Mixed — choose a value" : undefined}
        value={settings.mustPreserve ?? ""}
        onChange={(event) => onChange("mustPreserve", event.target.value)}
      />
    </label>)}
    {selectedProfile ? <aside className="image-profile-metadata" aria-label={`${selectedProfile.label} profile metadata`}>
      <strong>{selectedProfile.referenceModel}</strong>
      <span>Verified {selectedProfile.lastVerifiedAt} · {selectedProfile.profileVersion}</span>
      {selectedProfile.capabilityNotes.map((note) => <p key={note}>{note}</p>)}
    </aside> : null}
  </div>;
}
