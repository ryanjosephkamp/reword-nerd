// Turns what's in the workspace into the batch a hand-off covers.
import type { TaskFile, TextTaskInput } from "../engine/handoff/agentTask";
import { addAcceptedOcr } from "../engine/text";
import type { BatchFigure, TextBatch } from "../engine/handoff/textPrompt";
import type { TextProject, TextSource } from "../engine/types";
import type { Scope } from "./store";

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The files a hand-off covers: every included file, or just the selected one. */
export function scopedSources(
  sources: readonly TextSource[],
  scope: Scope,
  selectedId: string | null,
): TextSource[] {
  if (scope === "selected") {
    const selected = sources.find((source) => source.id === selectedId && source.included);
    return selected ? [selected] : [];
  }
  return sources.filter((source) => source.included);
}

function groupsOf(sources: readonly TextSource[]): Set<string | null> {
  return new Set(sources.map((source) => source.projectId));
}

/** Paths stay as they are unless files from different places are mixed, then each gets a folder. */
function batchPath(source: TextSource, projects: readonly TextProject[], mixed: boolean): string {
  if (!mixed) return source.path;
  const project = projects.find((candidate) => candidate.id === source.projectId);
  return project ? `${project.name}/${source.path}` : source.path;
}

export function batchTitle(
  sources: readonly TextSource[],
  projects: readonly TextProject[],
): string {
  if (sources.length === 1) return baseName(sources[0].path);
  const groups = groupsOf(sources);
  if (groups.size === 1) {
    const project = projects.find((candidate) => candidate.id === sources[0].projectId);
    if (project) return project.name;
  }
  return `${sources.length} documents`;
}

export function buildBatch(
  sources: readonly TextSource[],
  projects: readonly TextProject[],
): TextBatch {
  const groups = groupsOf(sources);
  const mixed = groups.size > 1;
  const onlyProject =
    !mixed && sources[0]?.projectId
      ? (projects.find((project) => project.id === sources[0].projectId) ?? null)
      : null;
  const figures: BatchFigure[] = sources.flatMap((source) =>
    source.assets.map((asset) => ({
      ref: `asset:${asset.id}`,
      filename: asset.filename,
      taskPath: `assets/${baseName(source.path)}/${asset.filename}`,
      caption: asset.caption,
      altText: asset.altText,
      pageNumber: asset.pageNumber,
    })),
  );
  return {
    title: batchTitle(sources, projects),
    files: sources.map((source) => ({
      path: batchPath(source, projects, mixed),
      text: source.text,
      format: source.format,
    })),
    project: onlyProject
      ? {
          name: onlyProject.name,
          latex: onlyProject.classification === "latex",
          mainFile: onlyProject.mainFile,
          excluded: onlyProject.excluded.map((entry) => entry.path),
        }
      : null,
    figures,
  };
}

export function buildTaskInput(
  sources: readonly TextSource[],
  projects: readonly TextProject[],
): TextTaskInput {
  const batch = buildBatch(sources, projects);
  const mixed = groupsOf(sources).size > 1;
  const files: TaskFile[] = sources.map((source) => ({
    path: batchPath(source, projects, mixed),
    original: source.original,
    text: source.text,
    extractedText: source.extractedText,
    format: source.format,
  }));
  const projectIds = groupsOf(sources);
  const projectAssets = projects
    .filter((project) => projectIds.has(project.id))
    .flatMap((project) =>
      project.assets.map((asset) => ({
        path: mixed ? `${project.name}/${asset.path}` : asset.path,
        bytes: asset.bytes,
      })),
    );
  const documentAssets = sources.flatMap((source) =>
    source.assets.map((asset) => ({
      path: `${baseName(source.path)}/${asset.filename}`,
      bytes: asset.bytes,
    })),
  );
  return { batch, files, assets: [...projectAssets, ...documentAssets] };
}

/** The extracted text with every accepted OCR passage placed on its page. */
export function textWithOcr(source: TextSource): string {
  return addAcceptedOcr(source.extractedText, source.ocr);
}
