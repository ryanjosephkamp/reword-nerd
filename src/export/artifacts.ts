import type { PromptSet } from "../domain";
import type { CombinedPromptArtifact, CombinedPromptBlock, PromptPackageManifest } from "./contracts";

const stageTitles: Record<keyof PromptSet, string> = {
  decompose: "Stage 1 — Decompose",
  rewrite: "Stage 2 — Rewrite",
  verify: "Stage 3 — Verify",
  final: "Stage 4 — Final",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fenceFor(value: string): string {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return "`".repeat(Math.max(4, longest + 1));
}

function markdownFor(
  runbookMarkdown: string,
  displayName: string,
  promptBlocks: readonly CombinedPromptBlock[],
): string {
  const sections = promptBlocks.map((block) => {
    const fence = fenceFor(block.content);
    return `## ${block.title}\n\n${fence}text\n${block.content}${block.content.endsWith("\n") ? "" : "\n"}${fence}`;
  });
  return `${runbookMarkdown}\n---\n\n# Combined prompts — ${displayName}\n\n${sections.join("\n\n")}\n`;
}

function htmlFor(
  runbookMarkdown: string,
  displayName: string,
  promptBlocks: readonly CombinedPromptBlock[],
): string {
  const prompts = promptBlocks.map((block) => {
    const actionName = block.stage[0].toUpperCase() + block.stage.slice(1);
    return `
    <section class="prompt-section" aria-labelledby="heading-${block.stage}">
      <div class="prompt-heading">
        <h2 id="heading-${block.stage}">${escapeHtml(block.title)}</h2>
        <button type="button" data-copy-target="prompt-${block.stage}" data-copy-label="${actionName}" aria-label="Copy ${actionName}" aria-describedby="copy-status">Copy prompt</button>
      </div>
      <pre><code id="prompt-${block.stage}">${escapeHtml(block.content)}</code></pre>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>Combined prompts — ${escapeHtml(displayName)}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #111; line-height: 1.55; }
    main { width: min(100% - 32px, 980px); margin: 0 auto; padding: 40px 0 72px; }
    h1 { margin: 0 0 24px; font-size: clamp(1.8rem, 6vw, 3rem); line-height: 1.08; }
    h2 { margin: 0; font-size: 1.15rem; }
    .runbook, pre { overflow: auto; border: 1px solid #bbb; background: #f7f7f7; padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .runbook { margin-bottom: 40px; }
    .prompt-section { margin-top: 36px; }
    .prompt-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    button { min-height: 44px; border: 2px solid #111; background: #fff; color: #111; padding: 8px 14px; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover, button:focus-visible { background: #111; color: #fff; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: .9rem; }
    #copy-status { min-height: 1.5em; font-weight: 700; }
    @media (max-width: 480px) { main { width: min(100% - 24px, 980px); padding-top: 24px; } .prompt-heading { align-items: stretch; flex-direction: column; } button { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <h1>Combined prompts — ${escapeHtml(displayName)}</h1>
    <section aria-labelledby="runbook-heading">
      <h2 id="runbook-heading">Package README</h2>
      <pre class="runbook"><code>${escapeHtml(runbookMarkdown)}</code></pre>
    </section>${prompts}
    <p id="copy-status" role="status" aria-live="polite"></p>
  </main>
  <script>
    (() => {
      const status = document.getElementById("copy-status");
      const selectForManualCopy = (node) => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      };
      const fallbackCopy = (text, node) => {
        const field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        let copied = false;
        try { copied = document.execCommand("copy"); } catch { copied = false; }
        field.remove();
        if (!copied) selectForManualCopy(node);
        return copied;
      };
      document.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-copy-target]");
        if (!button) return;
        const node = document.getElementById(button.dataset.copyTarget);
        if (!node) return;
        const label = button.dataset.copyLabel;
        const text = node.textContent;
        let copied = false;
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            copied = true;
          }
        } catch { copied = false; }
        if (!copied) copied = fallbackCopy(text, node);
        status.textContent = copied
          ? label + " copied."
          : "Copy unavailable. Select the " + label + " prompt manually, then press Ctrl+C or Command+C.";
        button.focus();
      });
    })();
  </script>
</body>
</html>
`;
}

export function createCombinedPromptArtifact(
  manifest: PromptPackageManifest,
  documentIndex: number,
  runbookMarkdown: string,
  promptSet: PromptSet,
): CombinedPromptArtifact {
  const document = manifest.documents[documentIndex];
  const runbook = Object.freeze({
    package: Object.freeze({ ...manifest.package }),
    documentKey: document.key,
    originalDisplayName: document.originalDisplayName,
    model: Object.freeze({
      ...document.model,
      promptStrategy: Object.freeze({ ...document.model.promptStrategy }),
    }),
    settings: Object.freeze({ ...document.settings }),
    contextAssessment: Object.freeze({ ...document.contextAssessment }),
    contextWarningAcknowledged: document.contextWarningAcknowledged,
    responseMarkers: Object.freeze({ ...manifest.workflow.responseMarkers }),
  });
  const promptBlocks = (Object.keys(stageTitles) as Array<keyof PromptSet>).map((stage) => Object.freeze({
    stage,
    title: stageTitles[stage],
    content: promptSet[stage],
  }));
  return Object.freeze({
    documentKey: document.key,
    originalDisplayName: document.originalDisplayName,
    runbook,
    runbookMarkdown,
    promptBlocks: Object.freeze(promptBlocks),
    markdown: markdownFor(runbookMarkdown, document.originalDisplayName, promptBlocks),
    html: htmlFor(runbookMarkdown, document.originalDisplayName, promptBlocks),
  });
}
