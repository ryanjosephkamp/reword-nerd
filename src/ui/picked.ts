// Reading what the user picked or dropped, keeping folder paths for projects.

export interface PickedFile {
  file: File;
  path: string;
}

export interface Picked {
  files: File[];
  /** Files that came from a dropped or chosen folder, with their paths inside it. */
  folder: PickedFile[];
}

async function readEntry(entry: FileSystemEntry, prefix: string, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ file, path: `${prefix}${entry.name}` });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns results in batches; keep reading until it returns none.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`, out);
  }
}

/** Reads a drop, keeping folder structure so projects arrive with their paths. */
export async function readDrop(transfer: DataTransfer): Promise<Picked> {
  const files: File[] = [];
  const folder: PickedFile[] = [];
  const entries = [...transfer.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  if (entries.some((entry) => entry?.isDirectory)) {
    for (const entry of entries) {
      if (entry?.isDirectory) await readEntry(entry, "", folder);
      else if (entry?.isFile) {
        files.push(
          await new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject),
          ),
        );
      }
    }
    return { files, folder };
  }
  return { files: [...transfer.files], folder };
}

/** Files from <input webkitdirectory>, with their paths inside the chosen folder. */
export function readFolderInput(list: FileList): Picked {
  return {
    files: [],
    folder: [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name })),
  };
}
