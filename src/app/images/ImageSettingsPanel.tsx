import type { AspectRatio, ImageSettings, ImageSource } from "../../engine/types";
import { ASPECT_LABELS } from "../../engine/handoff/imagePrompt";
import { useWorkspace } from "../store";

function Fields({
  settings,
  onChange,
}: {
  settings: ImageSettings;
  onChange: (patch: Partial<ImageSettings>) => void;
}) {
  return (
    <>
      <label className="field">
        <span className="field-label">What should change?</span>
        <textarea
          rows={3}
          value={settings.changes}
          placeholder="Leave empty for a faithful new version. For example: make it autumn, or use a watercolor style."
          onChange={(event) => onChange({ changes: event.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">What must stay exactly the same?</span>
        <textarea
          rows={2}
          value={settings.mustKeep}
          placeholder="For example: the logo, the woman's face, the chart values."
          onChange={(event) => onChange({ mustKeep: event.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">Shape</span>
        <select
          value={settings.aspectRatio}
          onChange={(event) => onChange({ aspectRatio: event.target.value as AspectRatio })}
        >
          {(Object.keys(ASPECT_LABELS) as AspectRatio[]).map((ratio) => (
            <option key={ratio} value={ratio}>
              {ASPECT_LABELS[ratio]}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.keepVisibleText}
          onChange={(event) => onChange({ keepVisibleText: event.target.checked })}
        />
        <span>Keep any text in the image word for word</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.keepBackground}
          onChange={(event) => onChange({ keepBackground: event.target.checked })}
        />
        <span>Keep the background, including transparency</span>
      </label>
    </>
  );
}

export function ImageSettingsPanel({ image }: { image: ImageSource | null }) {
  const defaults = useWorkspace((state) => state.imageDefaults);
  const setDefaults = useWorkspace((state) => state.setImageDefaults);
  const update = useWorkspace((state) => state.updateImage);
  const custom = image?.settings ?? null;

  return (
    <section className="panel-section" aria-labelledby="image-settings-heading">
      <h2 id="image-settings-heading" className="section-title">
        Set the new version
      </h2>
      {image && (
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={custom !== null}
            onChange={(event) =>
              update(image.id, { settings: event.target.checked ? { ...defaults } : null })
            }
          />
          <span>
            <strong>Different settings for this image</strong>
            <span className="muted small">Otherwise every image uses the settings below.</span>
          </span>
        </label>
      )}
      {image && custom ? (
        <Fields
          settings={custom}
          onChange={(patch) => update(image.id, { settings: { ...custom, ...patch } })}
        />
      ) : (
        <Fields settings={defaults} onChange={setDefaults} />
      )}
    </section>
  );
}
