// A folder or ZIP read as one project. Text files become TextSources that share the project's
// id, files the project needs but nobody rewrites (pictures, fonts, PDFs, bibliographies) become
// assets, and everything left out is listed with the reason.
import { clashReason, findClash, isSystemClutter, nameProblem } from "../paths";
import type { ProjectExclusion, Progress, TextProject, TextSource } from "../types";
import {
  createZipBudget,
  expandsTooMuch,
  listZip,
  ZipReadError,
  type ZipBudget,
  type ZipFile,
  type ZipOpener,
  type ZipSkip,
} from "../zip";
import { hasCredentialContent, isCredentialName } from "./credentials";
import { baseName, decodeText, extensionOf, PLAIN_TEXT, textKindForName } from "./formats";
import { findMainFile, missingReferenceNotes } from "./latex";
import { folderEntryPath } from "./paths";
import { makeTextSource } from "./source";
import { newId, ReadProblem } from "./util";

export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 20_000;
/** Files actually read, after dependency folders, lock files, and ignored files are skipped. */
export const MAX_PROJECT_FILES = 500;
export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
/** Beyond these, text files start out left out of the job so the hand-off stays a usable size. */
export const MAX_INCLUDED_TEXT_FILES = 250;
export const MAX_INCLUDED_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_GITIGNORE_BYTES = 1024 * 1024;

/** Folders that only ever hold dependencies, caches, or tool state, skipped at any depth. */
const ALWAYS_SKIPPED_FOLDERS = new Set([
  "node_modules",
  "bower_components",
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  ".tox",
  ".gradle",
  "Pods",
  ".terraform",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
]);

/**
 * Names that are build output beside a project's manifest but can be ordinary source folders
 * elsewhere (src/cache/, app/gen/), so they're skipped only at the root or next to a manifest.
 */
const BUILD_FOLDERS = new Set([
  "build",
  "dist",
  "out",
  "target",
  "coverage",
  "vendor",
  "vendors",
  "cache",
  "gen",
  "generated",
]);

const MANIFESTS = new Set([
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "setup.py",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
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

/** One file in a folder or ZIP. Only files that survive the path-based checks are read. */
export interface ProjectFile {
  path: string;
  size: number;
  /** True for a ZIP entry that would unpack to far more than its stored size. */
  expands: boolean;
  /** Reads the file, or says why it can't be (too large, locked, a link, or damaged). */
  read(limit: number, budget: ZipBudget): Promise<Uint8Array<ArrayBuffer> | ZipSkip>;
}

export interface ProjectReadOptions {
  /** Bytes still allowed to be read in this call, shared by every file and project in it. */
  budget: ZipBudget;
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
  /** Stand-in for zip.js in tests. */
  openZip?: ZipOpener;
}

export interface ProjectRead {
  project: TextProject;
  sources: TextSource[];
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** Folders holding a project manifest; "" stands for the root. */
function manifestFolders(files: readonly ProjectFile[]): Set<string> {
  return new Set(
    files.filter((file) => MANIFESTS.has(baseName(file.path))).map((file) => folderOf(file.path)),
  );
}

/** The first dependency or build folder in the path, such as "packages/app/dist/". */
function skippedFolder(path: string, manifests: ReadonlySet<string>): string | null {
  const segments = path.split("/");
  for (let depth = 0; depth < segments.length - 1; depth += 1) {
    const name = segments[depth];
    const parent = segments.slice(0, depth).join("/");
    const skipped =
      ALWAYS_SKIPPED_FOLDERS.has(name) ||
      (BUILD_FOLDERS.has(name.toLowerCase()) && (depth === 0 || manifests.has(parent)));
    if (skipped) return `${segments.slice(0, depth + 1).join("/")}/`;
  }
  return null;
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
  const manifests = manifestFolders(files);
  const candidates: ProjectFile[] = [];
  for (const file of files) {
    if (isSystemClutter(file.path)) continue;
    const folder = skippedFolder(file.path, manifests);
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
  if (!gitignore) return files;
  const bytes = await gitignore.read(MAX_GITIGNORE_BYTES, createZipBudget(MAX_GITIGNORE_BYTES));
  const decoded = bytes instanceof Uint8Array ? decodeText(bytes) : null;
  if (!decoded?.ok) return files;
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
  budget: ZipBudget,
): ProjectFile[] {
  const readable = files.filter((file) => {
    // One file that unpacks suspiciously is left out; the rest of the project still loads.
    if (file.size <= MAX_PROJECT_FILE_BYTES && !file.expands) return true;
    excluded.add(file.path, "too-large");
    return false;
  });
  if (readable.length > MAX_PROJECT_FILES) {
    throw new ReadProblem(
      `This ${noun} has more than ${MAX_PROJECT_FILES} files to read, even after skipping dependency and build folders. Add a smaller part of it.`,
    );
  }
  const total = readable.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_PROJECT_BYTES) {
    throw new ReadProblem(
      `The files in this ${noun} add up to more than 100 MB. Add a smaller part of it.`,
    );
  }
  if (total > budget.remaining) {
    throw new ReadProblem(
      `Together with the other files added at the same time, this ${noun} would pass the ${Math.round(budget.total / (1024 * 1024))} MB that can be read at once. Add it on its own.`,
    );
  }
  return readable;
}

function exclusionForSkip({ problem }: ZipSkip): ProjectExclusion {
  if (problem === "too-large" || problem === "expands" || problem === "over-budget") {
    return "too-large";
  }
  return problem === "link" || problem === "encrypted" ? "link-or-locked" : "unreadable-text";
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
  for (const [index, file] of files.entries()) {
    options.signal?.throwIfAborted();
    options.onProgress?.({
      label: `Reading ${name} (${index + 1} of ${files.length} files)`,
      completed: index,
      total: files.length,
    });
    const bytes = await file.read(MAX_PROJECT_FILE_BYTES, options.budget);
    if (!(bytes instanceof Uint8Array)) {
      // A password-protected file, a link, or a damaged entry is left out, not the project.
      excluded.add(file.path, exclusionForSkip(bytes));
      continue;
    }
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
  checkExpansion: (files: readonly ProjectFile[]) => void = () => undefined,
): Promise<ProjectRead> {
  const noun = from === "zip" ? "ZIP" : "folder";
  const excluded = new ExclusionList();
  const kept = await applyGitignore(screenPaths(files, excluded), excluded);
  for (const file of kept) {
    const problem = nameProblem(file.path);
    if (problem) throw new ReadProblem(problem);
  }
  const clash = findClash(kept.map((file) => file.path));
  if (clash) throw new ReadProblem(clashReason(clash, noun));
  const readable = applySizeLimits(kept, excluded, noun, options.budget);
  checkExpansion(readable);
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

/** The single top-level folder many ZIP tools wrap around everything, if there is one. */
function wrapperFolder(paths: readonly string[]): string | null {
  const root = paths[0]?.split("/")[0];
  if (!root || !paths.every((path) => path.startsWith(`${root}/`))) return null;
  return root;
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
  try {
    const zip = await listZip(file, {
      label: "ZIP",
      maxEntries: MAX_ZIP_ENTRIES,
      open: options.openZip,
      signal: options.signal,
    });
    try {
      const root = wrapperFolder(zip.files.map((entry) => entry.path));
      const entries = new Map<ProjectFile, ZipFile>();
      for (const entry of zip.files) {
        const projectFile: ProjectFile = {
          path: root ? entry.path.slice(root.length + 1) : entry.path,
          size: entry.size,
          expands: expandsTooMuch(entry),
          read: (limit, budget) => zip.unpack(entry, limit, budget),
        };
        entries.set(projectFile, entry);
      }
      const name = file.name.replace(/\.zip$/i, "") || file.name;
      return await buildProject(name, "zip", [...entries.keys()], options, (readable) =>
        zip.checkExpansion(readable.map((projectFile) => entries.get(projectFile)!)),
      );
    } finally {
      await zip.close();
    }
  } catch (error) {
    if (error instanceof ZipReadError) throw new ReadProblem(error.message);
    throw error;
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
      expands: false,
      read: async (limit, budget) => {
        if (file.size > limit) {
          return { path: projectPath, problem: "too-large", reason: "This file is too large." };
        }
        if (file.size > budget.remaining) {
          return { path: projectPath, problem: "over-budget", reason: "Too much to read at once." };
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          budget.remaining -= bytes.byteLength;
          return bytes;
        } catch {
          return { path: projectPath, problem: "damaged", reason: "This file couldn't be read." };
        }
      },
    };
  });
  return buildProject(name, "folder", files, options);
}
