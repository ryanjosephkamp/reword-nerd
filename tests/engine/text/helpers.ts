import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import type { ReadTextOptions } from "../../../src/engine/text";

export const encoder = new TextEncoder();

export const OFF: ReadTextOptions = { ocr: "off" };

export const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl1sAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

export function textFile(
  name: string,
  contents: string | Uint8Array<ArrayBuffer>,
  type = "",
): File {
  return new File([contents], name, { type });
}

export async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

export interface ZipOptions {
  level?: number;
  password?: string;
  /** Unix mode bits per entry, such as 0o120777 for a symbolic link. */
  modes?: Record<string, number>;
}

export async function makeZip(
  entries: Record<string, string | Uint8Array<ArrayBuffer>>,
  options: ZipOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    level: options.level ?? 6,
    ...(options.password ? { password: options.password } : {}),
  });
  for (const [path, contents] of Object.entries(entries)) {
    const reader =
      typeof contents === "string" ? new TextReader(contents) : new Uint8ArrayReader(contents);
    const mode = options.modes?.[path];
    await writer.add(path, reader, mode === undefined ? {} : { unixMode: mode });
  }
  return (await writer.close()) as Uint8Array<ArrayBuffer>;
}

export async function zipFile(
  name: string,
  entries: Record<string, string | Uint8Array<ArrayBuffer>>,
  options?: ZipOptions,
): Promise<File> {
  return new File([await makeZip(entries, options)], name, { type: "application/zip" });
}

/** Folder entries as <input webkitdirectory> gives them, all under one root folder. */
export function folder(
  root: string,
  files: Record<string, string | Uint8Array<ArrayBuffer>>,
): { file: File; path: string }[] {
  return Object.entries(files).map(([path, contents]) => ({
    file: textFile(path.slice(path.lastIndexOf("/") + 1), contents),
    path: `${root}/${path}`,
  }));
}
