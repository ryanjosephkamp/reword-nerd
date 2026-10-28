import { DownloadSimple, TextT, UploadSimple, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { readVisibleText } from "../../engine/images";
import type { ImageSource } from "../../engine/types";
import { DropZone } from "../../ui/DropZone";
import { downloadBlob } from "../../ui/download";
import { useObjectUrl } from "../../ui/useObjectUrl";
import { useWorkspace } from "../store";

const IMAGE_TYPES = /^image\/(png|jpeg|webp|avif|gif)$/;

export function ImagePreview({ image }: { image: ImageSource }) {
  const result = useWorkspace((state) => state.imageResults[image.id] ?? null);
  const setResult = useWorkspace((state) => state.setImageResult);
  const update = useWorkspace((state) => state.updateImage);
  const notify = useWorkspace((state) => state.notify);
  const originalUrl = useObjectUrl(image.original);
  const resultUrl = useObjectUrl(result);
  const [reading, setReading] = useState(false);
  const resultInput = useRef<HTMLInputElement>(null);

  async function readText() {
    setReading(true);
    try {
      const text = await readVisibleText(image.original);
      update(image.id, { visibleText: text });
      if (!text) notify("No text was found in this image.");
    } catch {
      notify("The text in this image couldn't be read.", "error");
    } finally {
      setReading(false);
    }
  }

  function takeResult(file: File | undefined) {
    if (!file) return;
    if (!IMAGE_TYPES.test(file.type)) {
      notify("That isn't an image file.", "error");
      return;
    }
    setResult(image.id, file);
  }

  return (
    <section className="pane pane-document" aria-labelledby="preview-heading">
      <header className="document-head">
        <div className="document-title">
          <h2 id="preview-heading" title={image.name}>
            {image.name}
          </h2>
          <p className="muted small">
            {image.width} × {image.height} pixels
            {image.from &&
              ` · from ${image.from.container}${image.from.pageNumber ? `, page ${image.from.pageNumber}` : ""}`}
          </p>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="btn"
            onClick={() => downloadBlob(image.original, image.name)}
            title="Save the image so you can attach it in your image tool"
          >
            <DownloadSimple aria-hidden />
            <span>Save image</span>
          </button>
        </div>
      </header>

      {image.notes.length > 0 && (
        <ul className="callout callout-warn notes-list">
          {image.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <DropZone
        label="Drop the new image to compare"
        onPick={(picked) => takeResult(picked.files[0] ?? picked.folder[0]?.file)}
        className="compare-drop"
      >
        <div className={`compare ${result ? "compare-two" : ""}`}>
          <figure>
            {originalUrl && (
              <img
                src={originalUrl}
                alt={`Original: ${image.name}`}
                draggable
                title="Drag this image into your image tool"
              />
            )}
            <figcaption>
              Original{!result && " · drag it into your image tool to attach it"}
            </figcaption>
          </figure>
          {result ? (
            <figure>
              {resultUrl && <img src={resultUrl} alt="The new version" />}
              <figcaption>
                New version
                <button
                  type="button"
                  className="btn-icon btn-icon-quiet"
                  aria-label="Remove the new version"
                  onClick={() => setResult(image.id, null)}
                >
                  <X aria-hidden />
                </button>
              </figcaption>
            </figure>
          ) : (
            <div className="drop-target">
              <p>Got a new version? Drop it here to compare it with the original.</p>
              <button type="button" className="btn" onClick={() => resultInput.current?.click()}>
                <UploadSimple aria-hidden />
                <span>Add the new version</span>
              </button>
              <input
                ref={resultInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  takeResult(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
          )}
        </div>
      </DropZone>

      <div className="pane-pad stack">
        <div className="row-between">
          <h3 className="field-label">Text in the image</h3>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => void readText()}
            disabled={reading}
          >
            <TextT aria-hidden />
            <span>{reading ? "Reading…" : image.visibleText ? "Read again" : "Read the text"}</span>
          </button>
        </div>
        <textarea
          rows={3}
          value={image.visibleText}
          placeholder="If the image has words in it, read them here and fix any mistakes. The prompt asks the model to keep them exactly."
          onChange={(event) => update(image.id, { visibleText: event.target.value })}
          aria-label="Text in the image"
        />
      </div>
    </section>
  );
}
