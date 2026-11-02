import { FolderOpen } from "@phosphor-icons/react";
import { useRef } from "react";
import { imageFileNames } from "../../engine/handoff/imagePrompt";
import type { ImageSource } from "../../engine/types";
import { DropZone } from "../../ui/DropZone";
import { readFolderInput, type Picked } from "../../ui/picked";
import { useWorkspace } from "../store";

function stem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

/** Matches the images an agent saved in output/ back to the images they came from. */
export function ImageBringBack({ images }: { images: ImageSource[] }) {
  const setResult = useWorkspace((state) => state.setImageResult);
  const notify = useWorkspace((state) => state.notify);
  const input = useRef<HTMLInputElement>(null);

  function take(picked: Picked) {
    const files = [
      ...picked.folder.map((entry) => ({ path: entry.path, file: entry.file })),
      ...picked.files.map((file) => ({ path: file.name, file })),
    ].filter((entry) => entry.file.type.startsWith("image/"));
    const fromOutput = files.filter((entry) => /(^|\/)output\//.test(entry.path));
    const candidates = fromOutput.length > 0 ? fromOutput : files;
    const byStem = new Map(candidates.map((entry) => [stem(entry.path), entry.file]));
    const names = imageFileNames(images);
    let matched = 0;
    for (const image of images) {
      const file = byStem.get(stem(names.get(image.id) ?? image.name));
      if (file) {
        setResult(image.id, file);
        matched += 1;
      }
    }
    notify(
      matched > 0
        ? `Added ${matched} new ${matched === 1 ? "version" : "versions"}. Pick an image to compare.`
        : "No new images matched. Drop the task folder after your agent has finished.",
      matched > 0 ? "info" : "error",
    );
  }

  return (
    <details className="bring-back">
      <summary>
        <span className="step-title">Bring the new images back</span>
        <span className="muted small"> optional</span>
      </summary>
      <DropZone onPick={take} label="Drop the finished task folder">
        <div className="drop-target">
          <p>Drop the finished task folder here to compare each new image with its original.</p>
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            <FolderOpen aria-hidden />
            <span>Choose folder</span>
          </button>
          <input
            ref={input}
            type="file"
            hidden
            // @ts-expect-error webkitdirectory is supported by every current browser but not typed.
            webkitdirectory=""
            onChange={(event) => {
              const list = event.target.files;
              if (list?.length) take(readFolderInput(list));
              event.target.value = "";
            }}
          />
        </div>
      </DropZone>
    </details>
  );
}
