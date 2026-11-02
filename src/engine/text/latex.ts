// LaTeX awareness: which file is the main document, and which other files a .tex file uses.
// Commented-out lines are ignored so an old `% \includegraphics{draft}` doesn't count.
import { baseName, extensionOf } from "./formats";
import { listSome } from "./util";

export function isTexPath(path: string): boolean {
  const extension = extensionOf(path);
  return extension === ".tex" || extension === ".ltx";
}

/** Removes `%` comments, keeping escaped `\%` signs. */
export function stripComments(source: string): string {
  return source.replace(/((?:^|[^\\])(?:\\\\)*)%.*$/gm, "$1");
}

export function hasDocumentClass(source: string): boolean {
  return /\\documentclass\s*(?:\[[^\]]*\])?\s*\{/.test(stripComments(source));
}

type ReferenceKind = "tex" | "graphics" | "bibliography";

export interface LatexReference {
  /** The name as written in the file, such as "figures/chart" or "refs". */
  written: string;
  kind: ReferenceKind;
}

const SUFFIXES: Readonly<Record<ReferenceKind, readonly string[]>> = {
  tex: [".tex", ".ltx"],
  graphics: [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".webp", ".gif", ".svg"],
  bibliography: [".bib"],
};

const REFERENCE_PATTERNS: readonly [RegExp, ReferenceKind][] = [
  [/\\(?:input|include|subfile)\s*\{([^}]+)\}/g, "tex"],
  [/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, "graphics"],
  [/\\bibliography\s*\{([^}]+)\}/g, "bibliography"],
  [/\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, "bibliography"],
];

export function latexReferences(source: string): LatexReference[] {
  const text = stripComments(source);
  const seen = new Set<string>();
  const references: LatexReference[] = [];
  for (const [pattern, kind] of REFERENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const items = kind === "bibliography" ? match[1].split(",") : [match[1]];
      for (const item of items) {
        const written = item.trim();
        // Macro arguments such as #1 and nested commands can't be resolved without running TeX.
        if (!written || /[\\{}#]/.test(written) || seen.has(`${kind}:${written}`)) continue;
        seen.add(`${kind}:${written}`);
        references.push({ written, kind });
      }
    }
  }
  return references;
}

function graphicsPaths(source: string): string[] {
  const match = /\\graphicspath\s*\{((?:\s*\{[^}]*\})+)\s*\}/.exec(stripComments(source));
  if (!match) return [];
  return [...match[1].matchAll(/\{([^}]*)\}/g)].map((item) => item[1].trim()).filter(Boolean);
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/** Joins and tidies a relative path, or returns null when it climbs out of the project. */
function resolvePath(directory: string, target: string): string | null {
  const parts: string[] = [];
  for (const part of `${directory}${target}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** The project paths a reference could mean, given where LaTeX looks for files. */
function candidatePaths(
  reference: LatexReference,
  filePath: string,
  mainFile: string | null,
  graphicsDirectories: readonly string[],
): string[] {
  const directories = new Set([directoryOf(mainFile ?? filePath), directoryOf(filePath)]);
  if (reference.kind === "graphics") {
    for (const directory of graphicsDirectories) {
      const resolved = resolvePath(directoryOf(mainFile ?? filePath), directory);
      if (resolved !== null) directories.add(resolved ? `${resolved}/` : "");
    }
  }
  const names = extensionOf(reference.written)
    ? [reference.written]
    : SUFFIXES[reference.kind].map((suffix) => `${reference.written}${suffix}`);
  const candidates: string[] = [];
  for (const directory of directories) {
    for (const name of names) {
      const resolved = resolvePath(directory, name);
      if (resolved) candidates.push(resolved);
    }
  }
  return candidates;
}

export interface MainFileChoice {
  isLatex: boolean;
  mainFile: string | null;
}

/** A project is LaTeX when a .tex file has \documentclass; the main file is picked when clear. */
export function findMainFile(files: readonly { path: string; text: string }[]): MainFileChoice {
  const candidates = files
    .filter((file) => isTexPath(file.path) && hasDocumentClass(file.text))
    .map((file) => file.path)
    .sort();
  if (candidates.length === 0) return { isLatex: false, mainFile: null };
  if (candidates.includes("main.tex")) return { isLatex: true, mainFile: "main.tex" };
  if (candidates.length === 1) return { isLatex: true, mainFile: candidates[0] };
  const named = candidates.filter((path) => baseName(path) === "main.tex");
  return { isLatex: true, mainFile: named.length === 1 ? named[0] : null };
}

/** Notes about files this .tex file uses that aren't among the project files. */
export function missingReferenceNotes(
  filePath: string,
  source: string,
  mainFile: string | null,
  isKept: (path: string) => boolean,
  isExcluded: (path: string) => boolean,
): string[] {
  const directories = graphicsPaths(source);
  const missing: string[] = [];
  const leftOut: string[] = [];
  for (const reference of latexReferences(source)) {
    const candidates = candidatePaths(reference, filePath, mainFile, directories);
    if (candidates.some(isKept)) continue;
    (candidates.some(isExcluded) ? leftOut : missing).push(reference.written);
  }
  const notes: string[] = [];
  if (missing.length > 0) {
    notes.push(
      `This file uses ${listSome(missing)}, which ${missing.length === 1 ? "isn't" : "aren't"} in the project.`,
    );
  }
  if (leftOut.length > 0) {
    notes.push(
      `This file uses ${listSome(leftOut)}, which ${leftOut.length === 1 ? "was" : "were"} left out of the project.`,
    );
  }
  return notes;
}

/** A single .tex file that uses other files can't bring them along. */
export function standaloneLatexNotes(source: string): string[] {
  const references = latexReferences(source).map((reference) => reference.written);
  if (references.length === 0) return [];
  return [
    `This file uses other files (${listSome(references)}). To include them, add the whole project as a folder or a ZIP.`,
  ];
}
