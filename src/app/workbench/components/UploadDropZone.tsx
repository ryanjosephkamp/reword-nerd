import type { ChangeEvent, RefObject } from "react";

interface UploadDropZoneProps {
  inputRef: RefObject<HTMLInputElement | null>;
  addButtonRef: RefObject<HTMLButtonElement | null>;
  dragging: boolean;
  hasDocuments: boolean;
  onOpen(): void;
  onChange(event: ChangeEvent<HTMLInputElement>): void;
}

export function UploadDropZone({
  inputRef,
  addButtonRef,
  dragging,
  hasDocuments,
  onOpen,
  onChange,
}: UploadDropZoneProps) {
  return <div className={`upload-drop-zone${dragging ? " is-dragging" : ""}`}>
    <input
      ref={inputRef}
      className="visually-hidden"
      type="file"
      aria-label="Add supported files"
      accept=".txt,.md,.markdown,.docx,.pdf"
      multiple
      onChange={onChange}
    />
    <button ref={addButtonRef} type="button" className="add-file-button" aria-label="Add files" onClick={onOpen}>+</button>
    <button type="button" className="empty-upload" hidden={hasDocuments} onClick={onOpen}>Start with files</button>
  </div>;
}
