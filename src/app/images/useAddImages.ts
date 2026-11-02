import { useCallback } from "react";
import { readImageFiles, readImageFolder, type ReadImagesOptions } from "../../engine/images";
import type { Picked } from "../../ui/picked";
import { useWorkspace } from "../store";

export function useAddImages() {
  const addImages = useWorkspace((state) => state.addImages);
  const setBusy = useWorkspace((state) => state.setBusy);
  const notify = useWorkspace((state) => state.notify);

  const add = useCallback(
    async (picked: Picked, pdf: ReadImagesOptions["pdf"] = "embedded-images") => {
      const options: ReadImagesOptions = {
        pdf,
        onProgress: (progress) =>
          setBusy(
            progress.total > 1
              ? `${progress.label} (${progress.completed} of ${progress.total})`
              : progress.label,
          ),
      };
      setBusy("Reading images…");
      try {
        if (picked.files.length > 0) {
          const result = await readImageFiles(picked.files, options);
          addImages(result.images, result.rejected);
        }
        if (picked.folder.length > 0) {
          const result = await readImageFolder(picked.folder, options);
          addImages(result.images, result.rejected);
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : "Those images couldn't be read.", "error");
      } finally {
        setBusy(null);
      }
    },
    [addImages, notify, setBusy],
  );

  const addSample = useCallback(async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}samples/garden-poster.png`);
    const blob = await response.blob();
    await add({
      files: [new File([blob], "garden-poster.png", { type: "image/png" })],
      folder: [],
    });
  }, [add]);

  return { add, addSample };
}
