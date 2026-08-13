import type { PromptPackageManifest, RunbookBlock, RunbookDocument, RunbookInline } from "./contracts";
import { isSafeArchivePath } from "./paths";

const text = (value: string): RunbookInline => Object.freeze({ type: "text", value });
const code = (value: string): RunbookInline => Object.freeze({ type: "code", value });
const link = (label: string, href: string): RunbookInline => Object.freeze({ type: "link", label, href });
const content = (...values: RunbookInline[]): readonly RunbookInline[] => Object.freeze(values);

function freezeBlock(block: RunbookBlock): RunbookBlock {
  if (block.type === "table") {
    return Object.freeze({ ...block, headers: Object.freeze([...block.headers]), rows: Object.freeze(block.rows.map((row) => Object.freeze([...row]))) });
  }
  if (block.type === "list") {
    return Object.freeze({ ...block, items: Object.freeze(block.items.map((item) => Object.freeze([...item]))) });
  }
  if (block.type === "code-block") return Object.freeze({ ...block });
  return Object.freeze({ ...block, content: Object.freeze([...block.content]) });
}

export function createRunbookDocument(manifest: PromptPackageManifest): Readonly<RunbookDocument> {
  const blocks: RunbookBlock[] = [
    { type: "heading", depth: 1, content: content(text("reword-nerd prompt package")) },
    { type: "paragraph", content: content(text("This package supports local One-shot and Manual rewriting workflows. It was generated locally and makes no provider call.")) },
    { type: "paragraph", content: content(text("Open "), code("OPEN-ME.html"), text(" for immediate document entry points. No exported HTML makes network requests or stores document data automatically.")) },
    {
      type: "table",
      headers: ["Document key", "Source", "One-shot", "Manual", "Combined", "Full HTML"],
      rows: manifest.documents.map((document) => [
        code(document.key),
        code(document.source.kind === "file" ? document.source.original.path : document.source.index.markdown.path),
        code(document.workbooks.oneShot.html.path),
        code(document.workbooks.manual.html.path),
        code(document.workbooks.combined.html.path),
        document.workbooks.combined.fullHtml.status === "generated"
          ? code(document.workbooks.combined.fullHtml.path)
          : text("Not generated: encoded size limit"),
      ]),
    },
  ];
  for (const document of manifest.documents) {
    const packagedProjectAssets = document.source.kind === "project"
      ? document.source.entries.filter((entry) => entry.contentKind === "asset" && entry.packageIncluded && entry.packaged)
      : [];
    blocks.push(
      { type: "heading", depth: 2, content: content(code(document.key)) },
      { type: "paragraph", content: content(text(`Selected model: ${document.model.label}`)) },
      { type: "paragraph", content: content(text(`Reference model: ${document.model.promptStrategy.referenceModel}`)) },
      { type: "paragraph", content: content(text(`Guidance version: ${document.model.promptStrategy.version}`)) },
      { type: "paragraph", content: content(text(`Workflow note: ${document.model.workflowNote}`)) },
      { type: "paragraph", content: content(text(`Resolved settings: ${JSON.stringify(document.settings)}`)) },
      { type: "paragraph", content: content(text(`Context estimates: One-shot ${document.contextAssessment.oneShotWorkflowTokens}; Manual ${document.contextAssessment.manualWorkflowTokens}; known limit: ${document.contextAssessment.contextWindowTokens ?? "unknown"}; required Manual warning acknowledged: ${document.contextAssessment.acknowledgmentRequired ? (document.contextWarningAcknowledged ? "yes" : "no") : "not required"}.`)) },
      { type: "paragraph", content: content(text("Reviewed extraction: "), code(document.reviewedExtraction.path)) },
      ...(document.source.kind === "project" ? [
        { type: "paragraph" as const, content: content(text("Reviewed project index: "), code(document.source.index.markdown.path), text(" and "), code(document.source.index.json.path), text(". This sanitized tree is AI context, not a source-control backup.")) },
        { type: "paragraph" as const, content: content(text("Project workflow: ask the model to return changed text files only, apply those blocks to a copy, inspect every diff, and run the project's normal tests/build. reword-nerd does not execute project code.")) },
        { type: "paragraph" as const, content: content(text("Project assets are references, not rewriteable text. When the model interface accepts attachments, attach the safe files listed below from "), code(`documents/${document.key}/project/files/`), text(" and ask the model to preserve their paths and use them where relevant.")) },
        ...(packagedProjectAssets.length > 0 ? [{
          type: "list" as const,
          ordered: false,
          items: packagedProjectAssets.map((entry) => content(link(entry.path, entry.packaged!.path))),
        }] : [{ type: "paragraph" as const, content: content(text("No safe non-text project assets are included.")) }]),
        { type: "paragraph" as const, content: content(text(`Project provenance: ${document.source.intakeKind} intake; ${document.source.entries.filter((entry) => entry.promptIncluded).length} prompt files; ${document.source.entries.filter((entry) => entry.packageIncluded).length} packaged entries; ${Object.values(document.source.sensitiveBlockedCounts).reduce((total, count) => total + count, 0)} sensitive files dropped before retention.`)) },
      ] : []),
      { type: "paragraph", content: content(text("Canonical Manual prompts: "), ...(["decompose", "rewrite", "verify", "final"] as const).flatMap((stage, index) => [code(document.prompts[stage].path), text(index === 3 ? "." : "; ")])) },
      { type: "paragraph", content: content(text(`Visual assets: ${document.visualAssets.records.filter((asset) => asset.included).length} included, ${document.visualAssets.records.filter((asset) => !asset.included).length} omitted; OCR records: ${document.ocr.records.length}; page count: ${document.processing.pageCount ?? "not applicable"}.`)) },
      { type: "paragraph", content: content(text("When the model interface supports image input, attach included assets using the filenames in assets/index.md. Otherwise provide the asset catalog and reviewed OCR text. Preserve every stable asset ID and place each figure near the relevant rewritten discussion.")) },
      { type: "paragraph", content: content(text("One-shot flow: copy "), code(document.prompts.oneShot.path), text(" into a new conversation. Expect only the marked final document and compact fidelity audit; intermediate reasoning remains internal.")) },
      {
        type: "list",
        ordered: true,
        items: [
          content(text("Start a new conversation and run Stage 1.")),
          content(text("Place the Stage 1 response in the matching marker, then run Stage 2.")),
          content(text("Fill both prior-response markers and run Stage 3.")),
          content(text("Fill all three markers, run Stage 4, and review the final output.")),
        ],
      },
      {
        type: "code-block",
        language: "text",
        value: [
          `Stage 1 marker: ${manifest.workflow.responseMarkers.stage1}`,
          `Stage 2 marker: ${manifest.workflow.responseMarkers.stage2}`,
          `Stage 3 marker: ${manifest.workflow.responseMarkers.stage3}`,
        ].join("\n"),
      },
    );
  }
  blocks.push({ type: "paragraph", content: content(text("Replace only the response markers and keep instruction/source blocks intact.")) });
  return Object.freeze({ type: "runbook-document", blocks: Object.freeze(blocks.map(freezeBlock)) });
}

function markdownText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]<>#])/gu, "\\$1")
    .replaceAll("://", "\\://");
}

function markdownCode(value: string): string {
  const delimiter = "`".repeat(Math.max(1, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length + 1)));
  return `${delimiter}${value}${delimiter}`;
}

function markdownCodeBlock(value: string, language = ""): string {
  const longestRun = Math.max(3, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${language}\n${value}\n${fence}`;
}

function safeHref(href: string): string {
  if (!isSafeArchivePath(href) || /^[a-z][a-z0-9+.-]*:/iu.test(href)) throw new Error("Runbook link must be archive-relative.");
  return href;
}

function markdownInline(value: RunbookInline): string {
  if (value.type === "text") return markdownText(value.value);
  if (value.type === "code") return markdownCode(value.value);
  return `[${markdownText(value.label)}](${safeHref(value.href).replaceAll("(", "%28").replaceAll(")", "%29")})`;
}

function markdownCell(values: readonly RunbookInline[]): string {
  return values.map(markdownInline).join("").replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

export function serializeRunbookMarkdown(document: Readonly<RunbookDocument>): string {
  const rendered = document.blocks.map((block) => {
    if (block.type === "heading") return `${"#".repeat(block.depth)} ${block.content.map(markdownInline).join("")}`;
    if (block.type === "paragraph") return block.content.map(markdownInline).join("");
    if (block.type === "list") return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${item.map(markdownInline).join("")}`).join("\n");
    if (block.type === "code-block") return markdownCodeBlock(block.value, block.language);
    return [
      `| ${block.headers.map((header) => markdownText(header)).join(" | ")} |`,
      `| ${block.headers.map(() => "---").join(" | ")} |`,
      ...block.rows.map((row) => `| ${row.map((cell) => markdownCell([cell])).join(" | ")} |`),
    ].join("\n");
  });
  return `${rendered.join("\n\n")}\n`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function htmlInline(value: RunbookInline, archiveRootPrefix: string): string {
  if (value.type === "text") return escapeHtml(value.value);
  if (value.type === "code") return `<code>${escapeHtml(value.value)}</code>`;
  return `<a href="${escapeHtml(`${archiveRootPrefix}${safeHref(value.href)}`)}">${escapeHtml(value.label)}</a>`;
}

export function renderRunbookHtml(
  document: Readonly<RunbookDocument>,
  options: Readonly<{ archiveRootPrefix?: string }> = {},
): string {
  const archiveRootPrefix = options.archiveRootPrefix ?? "";
  if (archiveRootPrefix && !/^(?:\.\.\/)+$/u.test(archiveRootPrefix)) throw new Error("Runbook archive root prefix is invalid.");
  return `<section class="runbook" aria-label="Package README">${document.blocks.map((block) => {
    if (block.type === "heading") return `<h${block.depth}>${block.content.map((value) => htmlInline(value, archiveRootPrefix)).join("")}</h${block.depth}>`;
    if (block.type === "paragraph") return `<p>${block.content.map((value) => htmlInline(value, archiveRootPrefix)).join("")}</p>`;
    if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${block.items.map((item) => `<li>${item.map((value) => htmlInline(value, archiveRootPrefix)).join("")}</li>`).join("")}</${tag}>`;
    }
    if (block.type === "code-block") return `<pre><code${block.language ? ` data-language="${escapeHtml(block.language)}"` : ""}>${escapeHtml(block.value)}</code></pre>`;
    return `<div class="runbook-table"><table><thead><tr>${block.headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${htmlInline(cell, archiveRootPrefix)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }).join("")}</section>`;
}
