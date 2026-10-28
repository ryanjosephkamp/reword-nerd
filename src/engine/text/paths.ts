// Path rules for project files: a ZIP can't point outside its own folder, and every kept file
// must have a name that unpacks cleanly on Windows, macOS, and Linux.
import { quotePath, ReadProblem } from "./util";

const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const encoder = new TextEncoder();

function hasUnsafeSegment(path: string): boolean {
  return path.split("/").some((segment) => !segment || segment === "." || segment === "..");
}

/** Turns a ZIP entry name into a project path, refusing names that could escape the project. */
export function zipEntryPath(name: string): string {
  // Some Windows tools write backslashes as folder separators.
  const path = name.replace(/\\/g, "/").normalize("NFC");
  const unsafe =
    !path ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    hasUnsafeSegment(path);
  if (unsafe) {
    throw new ReadProblem(
      `This ZIP has an unsafe file path (${quotePath(name)}), so it wasn't opened.`,
    );
  }
  return path;
}

/** Tidies a path from a folder the browser read. */
export function folderEntryPath(path: string): string {
  const tidy = path.normalize("NFC");
  if (!tidy || tidy.includes("\0") || hasUnsafeSegment(tidy)) {
    throw new ReadProblem(`This folder has a file path that can't be used (${quotePath(path)}).`);
  }
  return tidy;
}

/** Why a kept file's path can't be unpacked everywhere, or null when it's fine. */
export function portabilityProblem(path: string): string | null {
  for (const segment of path.split("/")) {
    if (CONTROL_CHARACTERS.test(segment)) {
      return "A file name here contains hidden control characters. Rename it and try again.";
    }
    if (RESERVED_NAMES.test(segment)) {
      const reserved = segment.split(".")[0].toUpperCase();
      return `${quotePath(path)} uses a name Windows reserves (${reserved}). Rename it and try again.`;
    }
    if (segment.includes(":") || segment.includes("\\") || /[. ]$/.test(segment)) {
      return `${quotePath(path)} has a name Windows can't use (it has a colon or backslash, or ends with a dot or space). Rename it and try again.`;
    }
    if (encoder.encode(segment).byteLength > 255) {
      return `A name in ${quotePath(path)} is too long. Shorten it and try again.`;
    }
  }
  if (encoder.encode(path).byteLength > 1_024) {
    return `The path ${quotePath(path)} is too long. Shorten it and try again.`;
  }
  return null;
}

/** Spelling that macOS and Windows treat as the same file name. */
function foldedName(path: string): string {
  return path.normalize("NFKC").toLocaleLowerCase("und").replaceAll("ß", "ss").replaceAll("ς", "σ");
}

/** Refuses two kept files that would land on the same name when unpacked. */
export function assertDistinctPaths(paths: readonly string[], noun: string): void {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  for (const path of paths) {
    if (exact.has(path)) {
      throw new ReadProblem(
        `This ${noun} has two files with the same name, ${quotePath(path)}. Rename one and try again.`,
      );
    }
    exact.add(path);
    const key = foldedName(path);
    const other = folded.get(key);
    if (other !== undefined) {
      throw new ReadProblem(
        `This ${noun} has two files whose names differ only in capital letters (${quotePath(other)} and ${quotePath(path)}). Rename one and try again.`,
      );
    }
    folded.set(key, path);
  }
}
