// Path rules shared by every reader of folders and ZIPs: what counts as system clutter, which
// names could escape their folder, and which names won't unpack cleanly on every computer.

const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_BYTES = 1_024;
const encoder = new TextEncoder();

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Files the operating system adds (macOS resource forks and folder icons, Finder and
 * Explorer metadata). People never see them, so they're skipped without a word.
 */
export function isSystemClutter(path: string): boolean {
  const name = lastSegment(path);
  return (
    path.split("/").includes("__MACOSX") ||
    name.startsWith("._") ||
    name === ".DS_Store" ||
    name === "Icon\r" ||
    name === "Thumbs.db" ||
    name === "desktop.ini"
  );
}

/**
 * A ZIP entry's name in standard form, or null when it could point outside the archive.
 * Backslashes count as folder separators, as Windows tools write them.
 */
export function archivePath(rawName: string, directory = false): string | null {
  let path = rawName.replace(/\\/g, "/").normalize("NFC");
  if (directory && path.endsWith("/")) path = path.slice(0, -1);
  const escapes =
    !path ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..");
  return escapes ? null : path;
}

/** "Name", quoted for a message: no control characters, and not too long. */
export function quotePath(path: string): string {
  const clean = path.replace(new RegExp(CONTROL_CHARACTERS.source, "g"), "");
  return `"${clean.length > 120 ? `${clean.slice(0, 117)}...` : clean}"`;
}

/** Why a file's path won't unpack on Windows, macOS, and Linux alike, or null when it will. */
export function nameProblem(path: string): string | null {
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
    if (encoder.encode(segment).byteLength > MAX_SEGMENT_BYTES) {
      return `A name in ${quotePath(path)} is too long. Shorten it and try again.`;
    }
  }
  if (encoder.encode(path).byteLength > MAX_PATH_BYTES) {
    return `The path ${quotePath(path)} is too long. Shorten it and try again.`;
  }
  return null;
}

/** The spelling macOS and Windows treat as the same name. */
function folded(path: string): string {
  return path.normalize("NFKC").toLocaleLowerCase("und").replaceAll("ß", "ss").replaceAll("ς", "σ");
}

/**
 * Two paths that would land on the same file when unpacked: the same name, names that differ
 * only in capital letters, or a file whose name is also a folder holding other files.
 */
export function findClash(paths: readonly string[]): [string, string] | null {
  const files = new Map<string, string>();
  const folders = new Map<string, string>();
  for (const path of paths) {
    const key = folded(path);
    const same = files.get(key) ?? folders.get(key);
    if (same !== undefined) return [same, path];
    files.set(key, path);
    const segments = key.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join("/");
      const file = files.get(folder);
      if (file !== undefined) return [file, path];
      if (!folders.has(folder)) folders.set(folder, path);
    }
  }
  return null;
}

/** A plain sentence for a clash found by findClash. */
export function clashReason([first, second]: [string, string], noun: string): string {
  if (first.normalize("NFC") === second.normalize("NFC")) {
    return `This ${noun} has two files with the same name, ${quotePath(second)}. Rename one and try again.`;
  }
  if (folded(first) === folded(second)) {
    return `This ${noun} has two files whose names differ only in capital letters (${quotePath(first)} and ${quotePath(second)}). Rename one and try again.`;
  }
  return `This ${noun} has a file and a folder with the same name (${quotePath(first)} and ${quotePath(second)}). Rename one and try again.`;
}
