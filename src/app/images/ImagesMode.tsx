import { ImageSquare, PaperPlaneTilt, Images } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { DropZone } from "../../ui/DropZone";
import { useWorkspace } from "../store";
import { AddImageButtons, ImageList } from "./ImageList";
import { ImageHandoff } from "./ImageHandoff";
import { ImagePreview } from "./ImagePreview";
import { ImageSettingsPanel } from "./ImageSettingsPanel";
import { useAddImages } from "./useAddImages";

type MobilePane = "images" | "preview" | "handoff";

function EmptyState() {
  const { addSample } = useAddImages();
  return (
    <div className="empty">
      <p className="eyebrow">Images</p>
      <h1 className="empty-title">
        Make a new version
        <br />
        <em>of any image.</em>
      </h1>
      <p className="empty-lede">
        Add images, or Word files, PDFs, and ZIPs that contain them. Say what should change and what
        must stay, then hand each one to Grok Imagine, ChatGPT, Gemini, Midjourney, or Codex.
      </p>
      <AddImageButtons />
      <p className="muted small">
        Or drop images anywhere on this page.{" "}
        <button type="button" className="link-button" onClick={() => void addSample()}>
          Try a sample image
        </button>
      </p>
    </div>
  );
}

export default function ImagesMode() {
  const { add } = useAddImages();
  const hasImages = useWorkspace((state) => state.images.length > 0);
  const selected = useWorkspace(
    (state) => state.images.find((image) => image.id === state.selectedImageId) ?? null,
  );
  const [pane, setPane] = useState<MobilePane>("preview");
  const selectedId = useWorkspace((state) => state.selectedImageId);
  const lastSelected = useRef(selectedId);
  useEffect(() => {
    // On phones, picking an item in the list should show it.
    if (selectedId !== lastSelected.current && pane === "images") setPane("preview");
    lastSelected.current = selectedId;
  }, [selectedId, pane]);

  if (!hasImages) {
    return (
      <DropZone
        onPick={(picked) => void add(picked)}
        label="Drop images to add them"
        className="mode"
      >
        <EmptyState />
      </DropZone>
    );
  }

  return (
    <DropZone
      onPick={(picked) => void add(picked)}
      label="Drop images to add them"
      className="mode"
    >
      <div
        className="workspace"
        data-pane={pane === "images" ? "files" : pane === "preview" ? "document" : "handoff"}
      >
        <div className="workspace-files">
          <ImageList />
        </div>
        <div className="workspace-center">
          {selected ? (
            <ImagePreview key={selected.id} image={selected} />
          ) : (
            <p className="pane-pad muted">Choose an image on the left.</p>
          )}
        </div>
        <aside className="workspace-side" aria-label="Image settings and hand-off">
          <ImageSettingsPanel image={selected} />
          <ImageHandoff selected={selected} />
        </aside>
      </div>
      <nav className="mobile-tabs" aria-label="Sections">
        {(
          [
            ["images", "Images", Images],
            ["preview", "Preview", ImageSquare],
            ["handoff", "Hand off", PaperPlaneTilt],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            aria-current={pane === id ? "page" : undefined}
            onClick={() => setPane(id)}
          >
            <Icon aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </DropZone>
  );
}
