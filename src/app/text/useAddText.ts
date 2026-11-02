import { useCallback } from "react";
import { readTextFiles, readTextFolder, type ReadTextOptions } from "../../engine/text";
import type { Picked } from "../../ui/picked";
import { useWorkspace } from "../store";

export type SampleName = "urban-gardens.md" | "reading-rooms.txt" | "shared-lists.md";

/** Reads picked files and folders into the workspace, with progress and errors shown. */
export function useAddText() {
  const addText = useWorkspace((state) => state.addText);
  const setBusy = useWorkspace((state) => state.setBusy);
  const notify = useWorkspace((state) => state.notify);

  const add = useCallback(
    async (picked: Picked) => {
      const options: ReadTextOptions = {
        ocr: "pages-without-text",
        onProgress: (progress) =>
          setBusy(
            progress.total > 1
              ? `${progress.label} (${progress.completed} of ${progress.total})`
              : progress.label,
          ),
      };
      setBusy("Reading files…");
      try {
        if (picked.files.length > 0) {
          const result = await readTextFiles(picked.files, options);
          addText(result.sources, result.projects, result.rejected);
        }
        if (picked.folder.length > 0) {
          const result = await readTextFolder(picked.folder, options);
          addText(result.sources, result.projects, result.rejected);
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : "Those files couldn't be read.", "error");
      } finally {
        setBusy(null);
      }
    },
    [addText, notify, setBusy],
  );

  const addSample = useCallback(
    async (name: SampleName = "urban-gardens.md") => {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
      const blob = await response.blob();
      await add({ files: [new File([blob], name, { type: "text/plain" })], folder: [] });
    },
    [add],
  );

  return { add, addSample };
}
