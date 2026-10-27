import { useMemo, useState } from "react";
import {
  cloneImagePromptSettings,
  isImagePromptSettingValue,
  type ImagePortalItem,
  type ImagePromptSettings,
} from "../contracts";
import type { ImagePortalAction, ImagePortalState, ImageSettingField } from "../reducer";
import { ImageSettingsFields } from "./ImageSettingsFields";
import { IMAGE_SETTING_FIELDS, selectBulkImages, selectCommonImageSettings } from "./selectors";

type SettingsScope = "defaults" | "selected";
type FieldMask = Record<ImageSettingField, boolean>;

function emptyMask(): FieldMask {
  return Object.fromEntries(IMAGE_SETTING_FIELDS.map((field) => [field, false])) as FieldMask;
}

export function ImageSettingsPanel({
  state,
  focusedItem,
  dispatch,
}: {
  state: ImagePortalState;
  focusedItem: Readonly<ImagePortalItem> | null;
  dispatch(action: ImagePortalAction): boolean;
}) {
  const [scope, setScope] = useState<SettingsScope>("defaults");
  const [masks, setMasks] = useState<FieldMask>(emptyMask);
  const [drafts, setDrafts] = useState<Partial<ImagePromptSettings>>({});
  const selected = selectBulkImages(state);
  const common = useMemo(() => selectCommonImageSettings(selected), [selected]);
  const selectedSettings = { ...common, ...drafts };
  const mixedFields = new Set(IMAGE_SETTING_FIELDS.filter((field) => selected.length > 0
    && !Object.hasOwn(common, field)
    && !Object.hasOwn(drafts, field)));
  const checkedFields = IMAGE_SETTING_FIELDS.filter((field) => masks[field]);
  const canApply = selected.length > 0 && checkedFields.length > 0 && checkedFields.every((field) => {
    const value = Object.hasOwn(drafts, field) ? drafts[field] : common[field];
    return isImagePromptSettingValue(field, value);
  });

  const updateDefaults = (field: ImageSettingField, value: unknown) => {
    if (!isImagePromptSettingValue(field, value)) return;
    const defaults = cloneImagePromptSettings(state.defaults);
    Object.assign(defaults, { [field]: value });
    dispatch({ type: "defaults/changed", defaults });
  };
  const updateFocused = (field: ImageSettingField, value: unknown) => {
    if (!focusedItem || !isImagePromptSettingValue(field, value)) return;
    dispatch({
      type: "item/setting-changed",
      itemId: focusedItem.id,
      expectedReviewRevision: focusedItem.reviewRevision,
      field,
      value,
    } as ImagePortalAction);
  };
  const apply = () => {
    if (!canApply) return;
    const patch: Partial<ImagePromptSettings> = {};
    for (const field of checkedFields) {
      const value = Object.hasOwn(drafts, field) ? drafts[field] : common[field];
      if (isImagePromptSettingValue(field, value)) Object.assign(patch, { [field]: value });
    }
    dispatch({
      type: "bulk/settings-applied",
      expectedReviewGeneration: state.reviewGeneration,
      fields: checkedFields,
      patch,
    });
    setMasks(emptyMask());
    setDrafts({});
  };

  return <div className="image-settings-content">
    <div role="group" aria-label="Image settings scope" className="image-settings-tabs">
      <button type="button" aria-pressed={scope === "defaults"} onClick={() => setScope("defaults")}>DEFAULTS</button>
      <button type="button" aria-pressed={scope === "selected"} onClick={() => setScope("selected")}>SELECTED [{selected.length}]</button>
    </div>
    {scope === "defaults" ? <section aria-label="Future image defaults">
      <p>These defaults are snapshotted only for images admitted later.</p>
      <ImageSettingsFields prefix="Default" settings={state.defaults} onChange={updateDefaults} />
    </section> : <>
      <section aria-label="Selected image settings">
        <p>Check a field, choose an explicit value, then Apply.</p>
        <ImageSettingsFields
          prefix="Selected"
          settings={selectedSettings}
          mixedFields={mixedFields}
          masks={masks}
          onMaskChange={(field, checked) => setMasks((current) => ({ ...current, [field]: checked }))}
          onChange={(field, value) => {
            if (!isImagePromptSettingValue(field, value)) return;
            setDrafts((current) => ({ ...current, [field]: value }));
          }}
        />
        <button type="button" disabled={!canApply} onClick={apply}>APPLY TO {selected.length} IMAGES</button>
      </section>
      <section className="image-focused-settings" aria-label="Focused image settings">
        <h3>FOCUSED IMAGE</h3>
        {focusedItem
          ? <ImageSettingsFields prefix="Focused" settings={focusedItem.settings} onChange={updateFocused} />
          : <p>Focus an image to edit its individual settings.</p>}
      </section>
    </>}
  </div>;
}
