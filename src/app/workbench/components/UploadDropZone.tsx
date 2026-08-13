import type { ChangeEvent, RefObject } from "react";

interface UploadDropZoneProps {
  inputRef: RefObject<HTMLInputElement | null>;
  addButtonRef: RefObject<HTMLButtonElement | null>;
  dragging: boolean;
  hasDocuments: boolean;
  onOpen(): void;
  onChange(event: ChangeEvent<HTMLInputElement>): void;
  folderInputRef: RefObject<HTMLInputElement | null>;
  onOpenFolder(): void;
  onFolderChange(event: ChangeEvent<HTMLInputElement>): void;
}

export function UploadDropZone({
  inputRef,
  addButtonRef,
  dragging,
  hasDocuments,
  onOpen,
  onChange,
  folderInputRef,
  onOpenFolder,
  onFolderChange,
}: UploadDropZoneProps) {
  return <div className={`upload-drop-zone${dragging ? " is-dragging" : ""}`}>
    <input
      ref={inputRef}
      className="visually-hidden"
      type="file"
      aria-label="Add supported files"
      multiple
      onChange={onChange}
    />
    <input
      ref={folderInputRef}
      className="visually-hidden"
      type="file"
      aria-label="Add folder project"
      multiple
      {...{ webkitdirectory: "" }}
      onChange={onFolderChange}
    />
    <button ref={addButtonRef} type="button" className="add-file-button" aria-label="Add files" onClick={onOpen}>+</button>
    <button type="button" className="add-folder-button" onClick={onOpenFolder}>ADD FOLDER</button>
    <p className="supported-file-hint">Documents, source code, strict UTF-8 text, and ZIP projects are checked locally.</p>
    <button type="button" className="empty-upload" hidden={hasDocuments} onClick={onOpen}>Start with files</button>
  </div>;
}
