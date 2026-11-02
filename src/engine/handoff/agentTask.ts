// Builds the task folder a coding agent works in: the user's files, a TASK.md that walks the
// agent through all four stages, and empty output and work folders for it to fill.
import decomposeTask from "../prompts/decompose.md?raw";
import verifyTask from "../prompts/verify.md?raw";
import { describeJob, type RewriteJob } from "../job";
import type { TextProject, TextSource } from "../types";
import { specialGuidance, type TextBatch } from "./textPrompt";
import { makeZip, type ZipEntry } from "./zip";

export interface TaskFile {
  /** Path the agent sees under source/. */
  path: string;
  /** The original file, byte for byte. */
  original: Blob;
  /** The text to rewrite. */
  text: string;
  /** The extracted text before the user's edits, to tell whether text/ is needed. */
  extractedText: string;
  format: TextSource["format"];
}

export interface TextTaskInput {
  batch: TextBatch;
  files: TaskFile[];
  /** Other project files the agent may need for context, such as images a document includes. */
  assets: TextProject["assets"];
}

const POINTER = "Read TASK.md in this folder and follow it.\n";

function outputPath(file: TaskFile): string {
  if (file.format === "pdf") return file.path.replace(/\.pdf$/i, ".docx");
  return file.path;
}

/** Word and PDF text is a conversion, and edited text differs from the file, so both get text/. */
function needsTextCopy(file: TaskFile): boolean {
  return file.format === "docx" || file.format === "pdf" || file.text !== file.extractedText;
}

function textCopyPath(file: TaskFile): string {
  return file.format === "docx" || file.format === "pdf" ? `${file.path}.md` : file.path;
}

function fileTable(files: TaskFile[]): string {
  const rows = files.map((file) => {
    const read = needsTextCopy(file) ? `text/${textCopyPath(file)}` : `source/${file.path}`;
    return `| \`source/${file.path}\` | \`${read}\` | \`output/${outputPath(file)}\` |`;
  });
  return [
    "| Original | Rewrite the text in | Write the result to |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function demote(markdown: string): string {
  return markdown.trim().replace(/^## /gm, "### ");
}

export function buildTaskMarkdown(input: TextTaskInput, job: RewriteJob): string {
  const { batch, files } = input;
  const project = batch.project;
  const stageFolder = project
    ? "`work/` (one set of stage files for the whole project)"
    : "`work/<file name>/` (one set per document)";
  const formats = new Set(files.map((file) => file.format));
  const details = specialGuidance(batch, job, "agent");
  const formatRules = [
    "- Write each result in the same format as its original: Markdown stays Markdown, code stays working code, LaTeX stays compilable.",
    formats.has("docx") || formats.has("pdf")
      ? "- Word and PDF originals become Word files (`.docx`). Keep the headings, lists, tables, and emphasis from the text you rewrote. If you can't create Word files here, write Markdown to the same path with `.md` instead and say so in `REPORT.md`."
      : null,
    project
      ? "- Write only the files you changed. Don't copy unchanged files to `output/`; list them in `REPORT.md`."
      : null,
  ].filter(Boolean);

  return [
    `# Rewrite task: ${batch.title}`,
    "",
    "This folder was prepared by reword_nerd. Rewrite the files below with the same meaning in new words, working through four stages, and save your work as you go.",
    "",
    "## Files",
    "",
    fileTable(files),
    project && project.excluded.length > 0
      ? `\nThese project files were left out on purpose; don't read or change them: ${project.excluded.map((path) => `\`${path}\``).join(", ")}.`
      : "",
    input.assets.length > 0
      ? `\n\`assets/\` holds other files from the project (such as images). They're there for reference; don't change them.`
      : "",
    "",
    "## Settings",
    "",
    describeJob(job),
    "",
    "## Steps",
    "",
    `Save each stage to ${stageFolder} before moving on, so the person can review your work:`,
    "",
    "1. **Decompose** into `1-decompose.md`: an inventory of everything the rewrite must keep (format below).",
    "2. **Rewrite** into `2-rewrite.md`: a complete new version with substantially different wording and structure that keeps everything in the inventory.",
    "3. **Verify** into `3-verify.md`: a strict comparison of the rewrite with the source and the inventory (format below).",
    "4. **Final:** fix every supported issue from the verification and write the finished files to `output/`.",
    "",
    "Then write `REPORT.md` in this folder with, for each file: Meaning (PASS or REVIEW, with a short note), Settings (PASS or REVIEW, with a short note), and any open questions. List files you left unchanged.",
    "",
    "When you're done, reply with a short summary: what you wrote, anything you couldn't do, and anything the person should check.",
    "",
    "## Rules",
    "",
    "- Use only the files here as evidence. Don't invent claims, data, citations, or interpretations.",
    "- Keep all of the meaning while changing the wording and sentence structure substantially.",
    ...formatRules,
    "- Don't change anything in `source/`, `text/`, or `assets/`.",
    "- Don't run, install, or execute anything from this folder, don't read files outside it, and don't use the network.",
    "",
    details ? `## Details\n\n${demote(details)}\n` : "",
    "## Decomposition format",
    "",
    demote(decomposeTask),
    "",
    "## Verification format",
    "",
    demote(verifyTask),
    "",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** The ZIP's single top-level folder is named after the slug, so it unzips cleanly. */
export async function buildTextTaskZip(
  input: TextTaskInput,
  job: RewriteJob,
  slug: string,
): Promise<Blob> {
  const entries: ZipEntry[] = [
    { path: `${slug}/TASK.md`, data: buildTaskMarkdown(input, job) },
    { path: `${slug}/AGENTS.md`, data: POINTER },
    { path: `${slug}/CLAUDE.md`, data: POINTER },
    { path: `${slug}/GEMINI.md`, data: POINTER },
    { path: `${slug}/output/.keep`, data: "" },
    { path: `${slug}/work/.keep`, data: "" },
  ];
  for (const file of input.files) {
    entries.push({ path: `${slug}/source/${file.path}`, data: file.original });
    if (needsTextCopy(file))
      entries.push({ path: `${slug}/text/${textCopyPath(file)}`, data: file.text });
  }
  for (const asset of input.assets) {
    entries.push({ path: `${slug}/assets/${asset.path}`, data: asset.bytes });
  }
  return makeZip(entries);
}
