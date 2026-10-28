// A folder or ZIP read as one project. Text files become TextSources that share the project's
// id, files the project needs but nobody rewrites (pictures, fonts, PDFs, bibliographies) become
// assets, and everything left out is listed with the reason.
import type { ProjectExclusion, Progress, TextProject, TextSource } from "../types";
import { hasCredentialContent, isCredentialName } from "./credentials";
import { baseName, decodeText, extensionOf, PLAIN_TEXT, textKindForName } from "./formats";
import { findMainFile, missingReferenceNotes } from "./latex";
import { assertDistinctPaths, folderEntryPath, portabilityProblem, zipEntryPath } from "./paths";
import { makeTextSource } from "./source";
import { concatBytes, newId, quotePath, ReadProblem } from "./util";

type FileEntry = import("@zip.js/zip.js").FileEntry;

export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 20_000;
/** Files actually read, after dependency folders, lock files, and ignored files are skipped. */
export const MAX_PROJECT_FILES = 500;
export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 100;
/** Small files can compress extremely well without being a threat, so the ratio check starts here. */
const RATIO_CHECK_MIN_BYTES = 1024 * 1024;
/** Beyond these, text files start out left out of the job so the hand-off stays a usable size. */
export const MAX_INCLUDED_TEXT_FILES = 250;
export const MAX_INCLUDED_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_GITIGNORE_BYTES = 1024 * 1024;

const EXCLUDED_FOLDERS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  "vendors",
  ".cache",
  "cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  "generated",
  "gen",
]);

const LOCK_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "poetry.lock",
  "pipfile.lock",
  "cargo.lock",
  "gemfile.lock",
  "composer.lock",
]);

const NESTED_ARCHIVES = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".rar", ".7z"]);

/** Build output: minified code, source maps, and the files LaTeX writes while compiling. */
const GENERATED_EXTENSIONS = new Set([
  ".map",
  ".aux",
  ".log",
  ".toc",
  ".lof",
  ".lot",
  ".out",
  ".blg",
  ".fls",
  ".fdb_latexmk",
  ".synctex",
  ".nav",
  ".snm",
  ".vrb",
  ".xdv",
  ".dvi",
]);

/** Files kept for the hand-off but never rewritten, with the type their Blob gets. */
const ASSET_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".eps": "application/postscript",
  ".pdf": "application/pdf",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".bib": "text/x-bibtex",
  ".bst": "text/plain",
  ".bbl": "text/plain",
};

/** LaTeX class and style files; in other projects these extensions can be ordinary code. */
const LATEX_SUPPORT_EXTENSIONS = new Set([".cls", ".sty"]);

const EXPANDS_TOO_MUCH =
  "This ZIP contains a file that expands to far more than its stored size, so it wasn't opened.";

/** One file in a folder or ZIP, read only if it survives the path-based checks. */
export interface ProjectFile {
  path: string;
  size: number;
  read(limit: number): Promise<Uint8Array<ArrayBuffer>>;
}

export interface ProjectReadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
}

export interface ProjectRead {
  project: TextProject;
  sources: TextSource[];
}

function isSystemJunk(path: string): boolean {
  const name = baseName(path);
  return (
    path.split("/").includes("__MACOSX") ||
    name.startsWith("._") ||
    name === ".DS_Store" ||
    name === "Thumbs.db" ||
    name === "desktop.ini"
  );
}

/** The first dependency or build folder in the path, such as "src/node_modules/". */
function excludedFolder(path: string): string | null {
  const segments = path.split("/");
  const index = segments
    .slice(0, -1)
    .findIndex((segment) => EXCLUDED_FOLDERS.has(segment.toLowerCase()));
  return index < 0 ? null : `${segments.slice(0, index + 1).join("/")}/`;
}

function exclusionByName(path: string): ProjectExclusion | null {
  const name = baseName(path).toLowerCase();
  const extension = extensionOf(name);
  if (LOCK_FILES.has(name)) return "lock-file";
  if (NESTED_ARCHIVES.has(extension)) return "nested-archive";
  if (GENERATED_EXTENSIONS.has(extension) || /\.min\.(?:js|css)$/.test(name)) {
    return "dependency-or-build-output";
  }
  if (isCredentialName(path)) return "credentials";
  return null;
}

/** Files left out, where a folder entry ending in "/" stands for everything inside it. */
class ExclusionList {
  private readonly items = new Map<string, ProjectExclusion>();

  add(path: string, reason: ProjectExclusion): void {
    if (!this.items.has(path)) this.items.set(path, reason);
  }

  covers(path: string): boolean {
    if (this.items.has(path)) return true;
    for (const excluded of this.items.keys()) {
      if (excluded.endsWith("/") && path.startsWith(excluded)) return true;
    }
    return false;
  }

  get size(): number {
    return this.items.size;
  }

  list(): TextProject["excluded"] {
    return [...this.items]
      .map(([path, reason]) => ({ path, reason }))
      .sort((left, right) => comparePaths(left.path, right.path));
  }
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Returns a matcher that gives the ignored path (a whole folder when possible), or null. */
async function loadGitignore(text: string): Promise<(path: string) => string | null> {
  const { default: ignore } = await import("ignore");
  const matcher = ignore().add(text);
  const ignores = (path: string) => {
    try {
      return matcher.ignores(path);
    } catch {
      return false;
    }
  };
  return (path) => {
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = `${segments.slice(0, depth).join("/")}/`;
      if (ignores(folder)) return folder;
    }
    return ignores(path) ? path : null;
  };
}

/** Skips system clutter and anything whose path alone rules it out. */
function screenPaths(files: readonly ProjectFile[], excluded: ExclusionList): ProjectFile[] {
  const candidates: ProjectFile[] = [];
  for (const file of files) {
    if (isSystemJunk(file.path)) continue;
    const folder = excludedFolder(file.path);
    const reason = folder ? "dependency-or-build-output" : exclusionByName(file.path);
    if (reason) excluded.add(folder ?? file.path, reason);
    else candidates.push(file);
  }
  return candidates;
}

/** Applies the project's root .gitignore, as git would. */
async function applyGitignore(
  files: ProjectFile[],
  excluded: ExclusionList,
): Promise<ProjectFile[]> {
  const gitignore = files.find((file) => file.path === ".gitignore");
  if (!gitignore || gitignore.size > MAX_GITIGNORE_BYTES) return files;
  const decoded = decodeText(await gitignore.read(MAX_GITIGNORE_BYTES));
  if (!decoded.ok) return files;
  const ignored = await loadGitignore(decoded.text);
  return files.filter((file) => {
    const match = file === gitignore ? null : ignored(file.path);
    if (match) excluded.add(match, "ignored-by-gitignore");
    return !match;
  });
}

/** Leaves out oversized files and refuses projects too big to read in the browser. */
function applySizeLimits(
  files: ProjectFile[],
  excluded: ExclusionList,
  noun: string,
): ProjectFile[] {
  const readable = files.filter((file) => {
    if (file.size <= MAX_PROJECT_FILE_BYTES) return true;
    excluded.add(file.path, "too-large");
    return false;
  });
  if (readable.length > MAX_PROJECT_FILES) {
    throw new ReadProblem(
      `This ${noun} has more than ${MAX_PROJECT_FILES} files to read, even after skipping dependency and build folders. Add a smaller part of it.`,
    );
  }
  if (readable.reduce((total, file) => total + file.size, 0) > MAX_PROJECT_BYTES) {
    throw new ReadProblem(
      `The files in this ${noun} add up to more than 100 MB. Add a smaller part of it.`,
    );
  }
  return readable;
}

interface DecodedFile {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
  text: string;
}

interface ProjectContents {
  textFiles: DecodedFile[];
  /** .cls and .sty files, which are assets only if the project turns out to be LaTeX. */
  latexSupport: DecodedFile[];
  assets: TextProject["assets"];
}

/** Reads each file and sorts it into text, asset, or excluded. */
async function readContents(
  files: ProjectFile[],
  excluded: ExclusionList,
  name: string,
  options: ProjectReadOptions,
): Promise<ProjectContents> {
  const contents: ProjectContents = {
    textFiles: [],
    latexSupport: [],
    assets: [],
  };
  let bytesRead = 0;
  for (const [index, file] of files.entries()) {
    options.signal?.throwIfAborted();
    options.onProgress?.({
      label: `Reading ${name} (${index + 1} of ${files.length} files)`,
      completed: index,
      total: files.length,
    });
    const bytes = await file.read(Math.min(MAX_PROJECT_FILE_BYTES, MAX_PROJECT_BYTES - bytesRead));
    bytesRead += bytes.byteLength;
    if (hasCredentialContent(bytes)) {
      excluded.add(file.path, "credentials");
      continue;
    }
    const extension = extensionOf(file.path);
    const assetType = ASSET_TYPES[extension];
    if (assetType !== undefined) {
      contents.assets.push({ path: file.path, bytes: new Blob([bytes], { type: assetType }) });
      continue;
    }
    const decoded = decodeText(bytes);
    if (decoded.ok) {
      const decodedFile = { path: file.path, bytes, text: decoded.text };
      if (LATEX_SUPPORT_EXTENSIONS.has(extension)) contents.latexSupport.push(decodedFile);
      else contents.textFiles.push(decodedFile);
    } else if (decoded.problem === "empty") {
      // Empty files such as __init__.py still matter to the project, so they travel as assets.
      contents.assets.push({ path: file.path, bytes: new Blob([bytes]) });
    } else {
      excluded.add(file.path, decoded.problem === "binary" ? "binary" : "unreadable-text");
    }
  }
  return contents;
}

/** Text files start out included until the job limits are reached. */
function applyJobLimits(sources: TextSource[]): void {
  let count = 0;
  let bytes = 0;
  for (const source of sources) {
    if (count >= MAX_INCLUDED_TEXT_FILES) {
      source.included = false;
      source.notes.push(
        `Left out of the job at first because the project has more than ${MAX_INCLUDED_TEXT_FILES} text files. Turn it on if you need it.`,
      );
    } else if (bytes + source.byteCount > MAX_INCLUDED_TEXT_BYTES) {
      source.included = false;
      source.notes.push(
        "Left out of the job at first because the project's text is over 5 MB. Turn it on if you need it.",
      );
    } else {
      count += 1;
      bytes += source.byteCount;
    }
  }
}

async function buildProject(
  name: string,
  from: TextProject["from"],
  files: readonly ProjectFile[],
  options: ProjectReadOptions,
): Promise<ProjectRead> {
  const noun = from === "zip" ? "ZIP" : "folder";
  const excluded = new ExclusionList();
  const kept = await applyGitignore(screenPaths(files, excluded), excluded);
  for (const file of kept) {
    const problem = portabilityProblem(file.path);
    if (problem) throw new ReadProblem(problem);
  }
  assertDistinctPaths(
    kept.map((file) => file.path),
    noun,
  );
  const readable = applySizeLimits(kept, excluded, noun);
  const { textFiles, latexSupport, assets } = await readContents(readable, excluded, name, options);

  const choice = findMainFile(textFiles);
  // Class and style files support a LaTeX project; elsewhere the same extensions can be code.
  if (choice.isLatex) {
    assets.push(
      ...latexSupport.map(({ path, bytes }) => ({
        path,
        bytes: new Blob([bytes], { type: "text/plain" }),
      })),
    );
  } else {
    textFiles.push(...latexSupport);
  }
  if (textFiles.length === 0) {
    throw new ReadProblem(
      excluded.size + assets.length > 0
        ? `This ${noun} has no text files that can be read. Everything in it was skipped or isn't text.`
        : `This ${noun} has no text files that can be read.`,
    );
  }
  textFiles.sort((left, right) => comparePaths(left.path, right.path));
  assets.sort((left, right) => comparePaths(left.path, right.path));

  const projectId = newId("project");
  const keptPaths = new Set([...textFiles, ...assets].map((file) => file.path));
  const sources: TextSource[] = [];
  for (const { path, bytes, text } of textFiles) {
    const kind = textKindForName(path) ?? { ...PLAIN_TEXT };
    const notes =
      choice.isLatex && kind.format === "latex"
        ? missingReferenceNotes(
            path,
            text,
            choice.mainFile,
            (candidate) => keptPaths.has(candidate),
            (candidate) => excluded.covers(candidate),
          )
        : [];
    sources.push(await makeTextSource({ path, projectId, kind, bytes, text, notes }));
  }
  applyJobLimits(sources);

  const project: TextProject = {
    id: projectId,
    name,
    from,
    classification: choice.isLatex ? "latex" : "general",
    mainFile: choice.mainFile,
    excluded: excluded.list(),
    assets,
  };
  return { project, sources };
}

/** Drops the single top-level folder many ZIP tools wrap around everything. */
function withoutWrapperFolder(files: ProjectFile[]): ProjectFile[] {
  const visible = files.filter((file) => !isSystemJunk(file.path));
  const root = visible[0]?.path.split("/")[0];
  if (!root || !visible.every((file) => file.path.startsWith(`${root}/`))) return files;
  return visible.map((file) => ({ ...file, path: file.path.slice(root.length + 1) }));
}

function isSymbolicLink(entry: FileEntry): boolean {
  const mode = entry.unixMode ?? entry.unixExternalUpper;
  return mode !== undefined && (mode & 0o170000) === 0o120000;
}

async function readZipEntry(
  entry: FileEntry,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    entry.uncompressedSize > RATIO_CHECK_MIN_BYTES &&
    entry.uncompressedSize / Math.max(1, entry.compressedSize) > MAX_COMPRESSION_RATIO
  ) {
    throw new ReadProblem(EXPANDS_TOO_MUCH);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Counting the real output guards against entries whose stated size is a lie.
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      total += chunk.byteLength;
      if (total > limit) throw new ReadProblem(EXPANDS_TOO_MUCH);
      chunks.push(chunk);
    },
  });
  try {
    await entry.getData(sink, { signal, checkOverlappingEntry: true });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ReadProblem) throw error;
    throw new ReadProblem("This ZIP file is damaged, so it couldn't be opened.");
  }
  return concatBytes(chunks, total);
}

export async function readZipProject(
  file: File,
  options: ProjectReadOptions,
): Promise<ProjectRead> {
  if (file.size > MAX_ZIP_BYTES) {
    throw new ReadProblem(
      "This ZIP is larger than 100 MB. Unzip it and add a smaller part, or make a smaller ZIP.",
    );
  }
  const { BlobReader, ZipReader } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    let entries: Awaited<ReturnType<typeof reader.getEntries>>;
    try {
      entries = await reader.getEntries();
    } catch {
      throw new ReadProblem("This ZIP file is damaged or isn't really a ZIP file.");
    }
    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new ReadProblem(
        `This ZIP has more than ${MAX_ZIP_ENTRIES.toLocaleString("en-US")} entries, which is too many to open.`,
      );
    }
    const files: ProjectFile[] = [];
    for (const entry of entries) {
      if (entry.directory) continue;
      const path = zipEntryPath(entry.filename);
      if (entry.encrypted) {
        throw new ReadProblem(
          "This ZIP is password-protected. Unzip it, then add the folder or a new ZIP without a password.",
        );
      }
      if (isSymbolicLink(entry)) {
        throw new ReadProblem(
          `This ZIP contains a shortcut (a symbolic link) at ${quotePath(path)}, which can't be opened safely.`,
        );
      }
      files.push({
        path,
        size: entry.uncompressedSize,
        read: (limit) => readZipEntry(entry, limit, options.signal),
      });
    }
    const name = file.name.replace(/\.zip$/i, "") || file.name;
    return await buildProject(name, "zip", withoutWrapperFolder(files), options);
  } finally {
    await reader.close().catch(() => undefined);
  }
}

/** Reads one folder. Paths are relative to the folder itself, without its name in front. */
export async function readFolderProject(
  name: string,
  entries: readonly { file: File; path: string }[],
  options: ProjectReadOptions,
): Promise<ProjectRead> {
  const files = entries.map(({ file, path }): ProjectFile => {
    const projectPath = folderEntryPath(path);
    return {
      path: projectPath,
      size: file.size,
      read: async (limit) => {
        if (file.size > limit) throw new ReadProblem(`${quotePath(projectPath)} is too large.`);
        try {
          return new Uint8Array(await file.arrayBuffer());
        } catch {
          throw new ReadProblem(
            `${quotePath(projectPath)} couldn't be read. Make sure the folder is still there and try again.`,
          );
        }
      },
    };
  });
  return buildProject(name, "folder", files, options);
}
