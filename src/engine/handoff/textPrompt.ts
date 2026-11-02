// Builds the prompts a person pastes into a chat app: one prompt that does everything,
// or four step-by-step prompts for documents that need a closer look at each stage.
import onePromptTask from "../prompts/one-prompt.md?raw";
import decomposeTask from "../prompts/decompose.md?raw";
import rewriteTask from "../prompts/rewrite.md?raw";
import verifyTask from "../prompts/verify.md?raw";
import finalTask from "../prompts/final.md?raw";
import { describeCodeScope, describeJob, type RewriteJob } from "../job";
import type { DocumentFormat } from "../types";

export interface BatchFile {
  path: string;
  text: string;
  format: DocumentFormat;
}

export interface BatchFigure {
  /** How the text refers to the figure, such as `asset:asset-0123456789ab`. */
  ref: string;
  filename: string;
  /** Where the figure is in an agent's task folder. */
  taskPath: string;
  caption?: string;
  altText?: string;
  pageNumber?: number;
}

/** Everything one hand-off covers: a single document, several documents, or a project. */
export interface TextBatch {
  title: string;
  files: BatchFile[];
  project: { name: string; latex: boolean; mainFile: string | null; excluded: string[] } | null;
  figures: BatchFigure[];
}

export type Stage = "decompose" | "rewrite" | "verify" | "final";
export const STAGES: readonly Stage[] = ["decompose", "rewrite", "verify", "final"];
export type StageReplies = Partial<Record<Exclude<Stage, "final">, string>>;

const CODE_FORMATS = new Set<DocumentFormat>([
  "html",
  "xml",
  "json",
  "jsonl",
  "ndjson",
  "csv",
  "tsv",
  "yaml",
  "toml",
  "ini",
  "config",
  "css",
  "sql",
  "code",
]);

export function isSingleDocument(batch: TextBatch): boolean {
  return batch.project === null && batch.files.length === 1;
}

/** Picks a marker that no line of the source already uses, so the model can't confuse them. */
export function sourceMarker(batch: TextBatch): string {
  const all = batch.files.map((file) => file.text).join("\n");
  let marker = "<<<";
  let suffix = 0;
  while (all.includes(`${marker}SOURCE`) || all.includes(`${marker}END SOURCE`)) {
    suffix += 1;
    marker = `<<<${suffix}:`;
  }
  return marker;
}

function renderSources(batch: TextBatch): string {
  const marker = sourceMarker(batch);
  return batch.files
    .map((file) => {
      const body = file.text.endsWith("\n") ? file.text : `${file.text}\n`;
      return `${marker}SOURCE ${file.path}>>>\n${body}${marker}END SOURCE ${file.path}>>>`;
    })
    .join("\n\n");
}

function intro(batch: TextBatch): string {
  if (isSingleDocument(batch)) {
    return `Below is a document to rewrite, \`${batch.files[0].path}\`. Your instructions follow it.`;
  }
  const what = batch.project ? `the project \`${batch.project.name}\`` : "several documents";
  return `Below are ${batch.files.length} files from ${what} to rewrite. Your instructions follow them.`;
}

/** Extra rules that depend on what kind of files are in the batch. */
export function specialGuidance(
  batch: TextBatch,
  job: RewriteJob,
  audience: "chat" | "agent" = "chat",
): string {
  const sections: string[] = [];
  const formats = new Set(batch.files.map((file) => file.format));
  if ([...formats].some((format) => CODE_FORMATS.has(format)) || batch.project) {
    sections.push(
      [
        "## Code and structured files",
        "",
        "In code and structured files, change only what this list allows:",
        "",
        describeCodeScope(job.codeScope),
        "",
        "Never claim you ran tests or builds.",
      ].join("\n"),
    );
  }
  if (formats.has("latex") || batch.project?.latex) {
    const main = batch.project?.mainFile ? ` The main file is \`${batch.project.mainFile}\`.` : "";
    sections.push(
      [
        "## LaTeX",
        "",
        `Keep the preamble, macros, math, citations, labels, references, file paths, and figure environments working.${main} Don't change bibliography files.`,
      ].join("\n"),
    );
  }
  if (audience === "chat" && (formats.has("docx") || formats.has("pdf"))) {
    sections.push(
      [
        "## Converted documents",
        "",
        "Word and PDF files were converted to Markdown for you. Return Markdown with the same headings, lists, tables, and emphasis; it will be turned back into a document.",
      ].join("\n"),
    );
  }
  if (batch.figures.length > 0) {
    const list = batch.figures
      .map((figure) => {
        const details = [
          figure.pageNumber ? `page ${figure.pageNumber}` : null,
          figure.caption ? `caption: ${figure.caption}` : null,
          figure.altText ? `description: ${figure.altText}` : null,
        ].filter(Boolean);
        const where = audience === "agent" ? `\`${figure.taskPath}\`` : figure.filename;
        return `- \`${figure.ref}\` is ${where}${details.length ? ` (${details.join("; ")})` : ""}`;
      })
      .join("\n");
    sections.push(
      [
        "## Figures",
        "",
        audience === "agent"
          ? "The text refers to these figures. Keep every reference next to the text it supports, and put the figures themselves in the finished files:"
          : "The source refers to these figures. Keep every figure reference, exactly as written, with its caption, next to the text it supports:",
        "",
        list,
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

function outputFormat(batch: TextBatch): string {
  if (isSingleDocument(batch)) {
    return [
      "## Output format",
      "",
      "Reply with exactly these two blocks and nothing before or after them:",
      "",
      "```text",
      "<<<FINAL_DOCUMENT>>>",
      "[The complete rewritten document]",
      "<<<END_FINAL_DOCUMENT>>>",
      "",
      "<<<FIDELITY_AUDIT>>>",
      "Meaning: PASS or REVIEW, with a short note",
      "Settings: PASS or REVIEW, with a short note",
      "Formatting and figures: PASS, NOT APPLICABLE, or REVIEW, with a short note",
      "Open questions: None, or a short list",
      "<<<END_FIDELITY_AUDIT>>>",
      "```",
    ].join("\n");
  }
  return [
    "## Output format",
    "",
    "Reply with one block per file you changed, then the audit, and nothing else. Give each changed file in full; never a diff or an excerpt. Use the exact paths above.",
    "",
    "```text",
    "<<<FILE path/to/file.ext>>>",
    "[The complete rewritten file]",
    "<<<END_FILE>>>",
    "",
    "<<<FIDELITY_AUDIT>>>",
    "Meaning: PASS or REVIEW, with a short note",
    "Settings: PASS or REVIEW, with a short note",
    "Unchanged files: None, or a list of paths you left as they were",
    "Open questions: None, or a short list",
    "<<<END_FIDELITY_AUDIT>>>",
    "```",
  ].join("\n");
}

function settingsBlock(job: RewriteJob): string {
  return `## Settings\n\n${describeJob(job)}`;
}

function excludedNote(batch: TextBatch): string {
  if (!batch.project || batch.project.excluded.length === 0) return "";
  return `These project files were left out and must not be changed: ${batch.project.excluded.join(", ")}.`;
}

function join(...parts: string[]): string {
  return parts.filter((part) => part.trim().length > 0).join("\n\n");
}

/** The single prompt that runs all four stages in one reply. */
export function buildOnePrompt(batch: TextBatch, job: RewriteJob): string {
  return join(
    intro(batch),
    renderSources(batch),
    excludedNote(batch),
    onePromptTask.trim(),
    settingsBlock(job),
    specialGuidance(batch, job),
    outputFormat(batch),
  );
}

const STAGE_TASKS: Record<Stage, string> = {
  decompose: decomposeTask,
  rewrite: rewriteTask,
  verify: verifyTask,
  final: finalTask,
};

const REPLY_LABELS: Record<Exclude<Stage, "final">, string> = {
  decompose: "STAGE 1 DECOMPOSITION",
  rewrite: "STAGE 2 REWRITE",
  verify: "STAGE 3 VERIFICATION",
};

/** Placeholder text the app swaps for the user's pasted reply from an earlier stage. */
export function replyPlaceholder(stage: Exclude<Stage, "final">): string {
  return `[${REPLY_LABELS[stage]} GOES HERE]`;
}

function earlierReplies(stage: Stage): Exclude<Stage, "final">[] {
  const order: Exclude<Stage, "final">[] = ["decompose", "rewrite", "verify"];
  return order.slice(0, STAGES.indexOf(stage));
}

/** One prompt per stage. Later stages contain placeholders for earlier replies. */
export function buildStagePrompt(batch: TextBatch, job: RewriteJob, stage: Stage): string {
  const replies = earlierReplies(stage).map(
    (earlier) =>
      `<<<${REPLY_LABELS[earlier]}>>>\n${replyPlaceholder(earlier)}\n<<<END ${REPLY_LABELS[earlier]}>>>`,
  );
  return join(
    `${intro(batch)} This is stage ${STAGES.indexOf(stage) + 1} of a four-stage rewrite.`,
    renderSources(batch),
    excludedNote(batch),
    ...replies,
    STAGE_TASKS[stage].trim(),
    settingsBlock(job),
    specialGuidance(batch, job),
    stage === "final" ? outputFormat(batch) : "",
  );
}

/** Swaps the placeholders for real replies. Throws if a needed reply is still missing. */
export function fillStagePrompt(prompt: string, stage: Stage, replies: StageReplies): string {
  let filled = prompt;
  for (const earlier of earlierReplies(stage)) {
    const reply = replies[earlier]?.trim();
    if (!reply) throw new Error(`Paste the reply from stage ${STAGES.indexOf(earlier) + 1} first.`);
    filled = filled.replace(replyPlaceholder(earlier), () => reply);
  }
  return filled;
}
