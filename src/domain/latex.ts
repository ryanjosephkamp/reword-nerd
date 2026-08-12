import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, type Entry } from "@zip.js/zip.js";
import { parse } from "@unified-latex/unified-latex-util-parse";

import { hashBytes, type HashAdapter } from "./extraction";
import type { LatexProjectMetadata, LatexProjectFile, VisualAsset } from "./media";

export const MAX_LATEX_ARCHIVE_ENTRIES = 500;
export const MAX_LATEX_ENTRY_BYTES = 25 * 1024 * 1024;
export const MAX_LATEX_PROJECT_BYTES = 100 * 1024 * 1024;
export const MAX_LATEX_COMPRESSION_RATIO = 100;

export type LatexArchiveIssue =
  | "UNSAFE_ARCHIVE"
  | "ARCHIVE_LIMIT_EXCEEDED"
  | "INVALID_LATEX_PROJECT";

export class LatexArchiveError extends Error {
  constructor(readonly code: LatexArchiveIssue) {
    super(code);
    this.name = "LatexArchiveError";
  }
}

interface ProjectEntry {
  path: string;
  bytes: Uint8Array;
}

export interface SafeLatexProjectFile {
  path: string;
  bytes: Uint8Array;
}

interface ReadProject {
  entries: ProjectEntry[];
  texPaths: string[];
}

const visualExtensions: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".eps": "application/postscript",
  ".pdf": "application/pdf",
};

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}

function normalizeSafePath(path: string): string {
  const normalized = path.normalize("NFC");
  if (!normalized
    || normalized.includes("\0")
    || normalized.includes("\\")
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new LatexArchiveError("UNSAFE_ARCHIVE");
  }
  return normalized;
}

function isSymlink(entry: Entry): boolean {
  const mode = entry.unixMode ?? entry.unixExternalUpper;
  return mode !== undefined && (mode & 0o170000) === 0o120000;
}

async function readLatexProject(bytes: Uint8Array, includeData: boolean): Promise<ReadProject> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes.slice()));
  try {
    const zipEntries = await reader.getEntries();
    if (zipEntries.length > MAX_LATEX_ARCHIVE_ENTRIES) {
      throw new LatexArchiveError("ARCHIVE_LIMIT_EXCEEDED");
    }
    let totalBytes = 0;
    const paths = new Set<string>();
    const entries: ProjectEntry[] = [];
    const texPaths: string[] = [];
    for (const entry of zipEntries) {
      if (entry.directory) continue;
      const path = normalizeSafePath(entry.filename);
      if (paths.has(path) || entry.encrypted || isSymlink(entry)) {
        throw new LatexArchiveError("UNSAFE_ARCHIVE");
      }
      paths.add(path);
      const uncompressedSize = entry.uncompressedSize;
      const compressedSize = Math.max(1, entry.compressedSize);
      totalBytes += uncompressedSize;
      if (uncompressedSize > MAX_LATEX_ENTRY_BYTES
        || totalBytes > MAX_LATEX_PROJECT_BYTES
        || uncompressedSize / compressedSize > MAX_LATEX_COMPRESSION_RATIO) {
        throw new LatexArchiveError("ARCHIVE_LIMIT_EXCEEDED");
      }
      const ext = extension(path);
      if (ext === ".tex" || ext === ".ltx") texPaths.push(path);
      if (includeData) {
        if (!entry.getData) throw new LatexArchiveError("INVALID_LATEX_PROJECT");
        entries.push({ path, bytes: await entry.getData(new Uint8ArrayWriter()) });
      }
    }
    if (texPaths.length === 0) throw new LatexArchiveError("INVALID_LATEX_PROJECT");
    return { entries, texPaths: texPaths.sort() };
  } catch (error) {
    if (error instanceof LatexArchiveError) throw error;
    throw new LatexArchiveError("INVALID_LATEX_PROJECT");
  } finally {
    await reader.close().catch(() => undefined);
  }
}

export async function validateLatexProjectArchive(bytes: Uint8Array): Promise<void> {
  await readLatexProject(bytes, false);
}

export async function readSafeLatexProjectFiles(bytes: Uint8Array): Promise<SafeLatexProjectFile[]> {
  const project = await readLatexProject(bytes, true);
  return project.entries.map((entry) => ({ path: entry.path, bytes: entry.bytes.slice() }));
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LatexArchiveError("INVALID_LATEX_PROJECT");
  }
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

function resolveRelative(sourcePath: string, target: string): string {
  const parts = `${dirname(sourcePath)}${target}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return target;
      stack.pop();
    } else stack.push(part);
  }
  return stack.join("/");
}

function dependenciesFor(path: string, source: string, available: Set<string>): string[] {
  const resolved = new Set<string>();
  const add = (raw: string, extensions: readonly string[]) => {
    const cleaned = raw.trim();
    if (!cleaned || /[\\{}]/.test(cleaned)) return;
    const base = resolveRelative(path, cleaned);
    const candidates = extension(base) ? [base] : extensions.map((suffix) => `${base}${suffix}`);
    resolved.add(candidates.find((candidate) => available.has(candidate)) ?? candidates[0]);
  };
  for (const match of source.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)) add(match[1], [".tex", ".ltx"]);
  for (const match of source.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
    add(match[1], [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".eps"]);
  }
  for (const match of source.matchAll(/\\bibliography\s*\{([^}]+)\}/g)) {
    for (const item of match[1].split(",")) add(item, [".bib"]);
  }
  for (const match of source.matchAll(/\\addbibresource(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) add(match[1], [".bib"]);
  return [...resolved].sort();
}

function findCycles(dependencies: Record<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (path: string, chain: string[]) => {
    if (visiting.has(path)) {
      const start = chain.indexOf(path);
      cycles.push([...chain.slice(start), path]);
      return;
    }
    if (visited.has(path)) return;
    visiting.add(path);
    for (const dependency of dependencies[path] ?? []) {
      if (dependencies[dependency]) visit(dependency, [...chain, path]);
    }
    visiting.delete(path);
    visited.add(path);
  };
  Object.keys(dependencies).sort().forEach((path) => visit(path, []));
  return cycles;
}

function chooseMainFile(sources: Map<string, string>): { mainFile: string | null; candidates: string[] } {
  if (sources.has("main.tex")) return { mainFile: "main.tex", candidates: ["main.tex"] };
  const candidates = [...sources].filter(([, source]) => /\\documentclass(?:\[[^\]]*\])?\s*\{/.test(source)).map(([path]) => path).sort();
  return { mainFile: candidates.length === 1 ? candidates[0] : null, candidates };
}

function fileKind(path: string): LatexProjectFile["kind"] {
  const ext = extension(path);
  if (ext === ".tex" || ext === ".ltx") return "tex";
  if (ext === ".bib") return "bibliography";
  if (visualExtensions[ext]) return "visual";
  return "other";
}

export interface LatexProjectExtraction {
  text: string;
  warnings: string[];
  assets: VisualAsset[];
  project: LatexProjectMetadata;
}

export async function extractLatexProject(
  bytes: Uint8Array,
  hasher?: HashAdapter | null,
): Promise<LatexProjectExtraction> {
  const project = await readLatexProject(bytes, true);
  const available = new Set(project.entries.map((entry) => entry.path));
  const sources = new Map<string, string>();
  const warnings: string[] = [];
  for (const entry of project.entries) {
    if (/\.(?:tex|ltx)$/i.test(entry.path)) {
      const source = decodeUtf8(entry.bytes);
      sources.set(entry.path, source);
      try {
        parse(source);
      } catch {
        warnings.push(`${entry.path} contains syntax that could not be fully analyzed; its source was preserved exactly.`);
      }
    }
  }
  const main = chooseMainFile(sources);
  if (!main.mainFile) warnings.push("Select the LaTeX project main file before confirming review.");
  const dependencies: Record<string, string[]> = {};
  for (const [path, source] of [...sources].sort(([left], [right]) => left.localeCompare(right))) {
    dependencies[path] = dependenciesFor(path, source, available);
  }
  const missingDependencies = [...new Set(Object.values(dependencies).flat().filter((path) => !available.has(path)))].sort();
  if (missingDependencies.length > 0) warnings.push(`Missing LaTeX project dependencies: ${missingDependencies.join(", ")}.`);
  const cycles = findCycles(dependencies);
  if (cycles.length > 0) warnings.push("The LaTeX project contains a cyclic include chain.");

  const files: LatexProjectFile[] = [];
  const assets: VisualAsset[] = [];
  for (const [order, entry] of project.entries.sort((left, right) => left.path.localeCompare(right.path)).entries()) {
    const sha256 = await hashBytes(entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength), hasher);
    const kind = fileKind(entry.path);
    files.push({ path: entry.path, byteCount: entry.bytes.byteLength, sha256, kind });
    const mimeType = visualExtensions[extension(entry.path)];
    if (mimeType) {
      assets.push({
        id: `asset-${sha256.slice(0, 12)}`,
        kind: "latex-asset",
        filename: entry.path.slice(entry.path.lastIndexOf("/") + 1),
        mimeType,
        bytes: entry.bytes.slice(),
        byteCount: entry.bytes.byteLength,
        sha256,
        order,
        sourcePath: entry.path,
        included: true,
        decorative: false,
        warnings: mimeType === "image/svg+xml" || mimeType === "application/postscript"
          ? ["This asset is preserved but is not executed or rendered in the workbench."]
          : [],
      });
    }
  }
  const orderedSources = [...sources].sort(([left], [right]) => {
    if (left === main.mainFile) return -1;
    if (right === main.mainFile) return 1;
    return left.localeCompare(right);
  });
  const text = orderedSources.map(([path, source]) => `<<<FILE ${path}>>>\n${source}${source.endsWith("\n") ? "" : "\n"}<<<END FILE>>>`).join("\n\n");
  return {
    text,
    warnings,
    assets,
    project: {
      mainFile: main.mainFile,
      mainFileCandidates: main.candidates,
      files,
      dependencies,
      missingDependencies,
      cycles,
    },
  };
}

export function analyzeStandaloneLatex(source: string): string[] {
  try {
    parse(source);
    return [];
  } catch {
    return ["The LaTeX source contains syntax that could not be fully analyzed; its source was preserved exactly."];
  }
}
