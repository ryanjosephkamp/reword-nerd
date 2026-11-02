import { FolderPlus, ImageSquare, Trash } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { ImageSource } from "../../engine/types";
import { readFolderInput } from "../../ui/picked";
import { useObjectUrl } from "../../ui/useObjectUrl";
import { useWorkspace } from "../store";
import { useAddImages } from "./useAddImages";

const ACCEPT = ".png,.jpg,.jpeg,.webp,.avif,.docx,.pdf,.zip";

function Thumb({ image }: { image: ImageSource }) {
  const url = useObjectUrl(image.original);
  const selected = useWorkspace((state) => state.selectedImageId === image.id);
  const hasResult = useWorkspace((state) => image.id in state.imageResults);
  const select = useWorkspace((state) => state.selectImage);
  const update = useWorkspace((state) => state.updateImage);
  const remove = useWorkspace((state) => state.removeImage);
  return (
    <li className={`thumb ${selected ? "thumb-selected" : ""}`}>
      <button type="button" className="thumb-button" onClick={() => select(image.id)}>
        {url && <img src={url} alt="" />}
        <span className="thumb-name" title={image.name}>
          {image.name}
        </span>
        <span className="muted small">
          {image.width} × {image.height}
          {hasResult && " · new version added"}
        </span>
      </button>
      <div className="thumb-tools">
        <input
          type="checkbox"
          checked={image.included}
          onChange={(event) => update(image.id, { included: event.target.checked })}
          aria-label={`Include ${image.name}`}
        />
        <button
          type="button"
          className="btn-icon btn-icon-quiet"
          aria-label={`Remove ${image.name}`}
          onClick={() => remove(image.id)}
        >
          <Trash aria-hidden />
        </button>
      </div>
    </li>
  );
}

export function AddImageButtons() {
  const { add } = useAddImages();
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<"embedded-images" | "page-captures">("embedded-images");
  return (
    <div className="stack-tight">
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={() => files.current?.click()}>
          <ImageSquare aria-hidden />
          <span>Add images</span>
        </button>
        <button type="button" className="btn btn-folder" onClick={() => folder.current?.click()}>
          <FolderPlus aria-hidden />
          <span>Add folder</span>
        </button>
      </div>
      <label className="check small">
        <input
          type="checkbox"
          checked={pdf === "page-captures"}
          onChange={(event) => setPdf(event.target.checked ? "page-captures" : "embedded-images")}
        />
        <span>From PDFs, take whole pages instead of the pictures inside them</span>
      </label>
      <input
        ref={files}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const list = [...(event.target.files ?? [])];
          event.target.value = "";
          if (list.length) void add({ files: list, folder: [] }, pdf);
        }}
      />
      <input
        ref={folder}
        type="file"
        hidden
        // @ts-expect-error webkitdirectory is supported by every current browser but not typed.
        webkitdirectory=""
        onChange={(event) => {
          const list = event.target.files;
          if (list?.length) void add(readFolderInput(list), pdf);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export function ImageList() {
  const images = useWorkspace((state) => state.images);
  const rejected = useWorkspace((state) => state.rejected);
  const dismissRejected = useWorkspace((state) => state.dismissRejected);
  const included = images.filter((image) => image.included).length;
  return (
    <section className="pane pane-files" aria-labelledby="images-heading">
      <header className="pane-head">
        <h2 id="images-heading">Images</h2>
        <span className="muted small">
          {included} of {images.length} included
        </span>
      </header>
      <AddImageButtons />
      {rejected.length > 0 && (
        <div className="callout callout-warn" role="status">
          <p>
            <strong>Not added</strong>
          </p>
          <ul className="plain-list">
            {rejected.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                {item.name}: {item.reason}
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" onClick={dismissRejected}>
            Dismiss
          </button>
        </div>
      )}
      <ul className="thumb-list">
        {images.map((image) => (
          <Thumb key={image.id} image={image} />
        ))}
      </ul>
    </section>
  );
}
