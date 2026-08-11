import { useMemo, useState } from "react";
import type { CombinedPromptArtifact } from "../../../export";
import { copyText } from "../copyText";

interface PackagePreviewProps {
  artifacts: readonly CombinedPromptArtifact[];
  selectedDocumentKey: string | null;
  onSelect(documentKey: string): void;
}

export function PackagePreview({ artifacts, selectedDocumentKey, onSelect }: PackagePreviewProps) {
  const artifact = useMemo(
    () => artifacts.find((candidate) => candidate.documentKey === selectedDocumentKey) ?? artifacts[0],
    [artifacts, selectedDocumentKey],
  );
  const [copyStatus, setCopyStatus] = useState("");

  if (!artifact) {
    return <div className="package-preview-empty">No package artifact is available.</div>;
  }

  const copyPrompt = async (title: string, content: string) => {
    const result = await copyText(content);
    setCopyStatus(result === "copied"
      ? `${title} prompt copied.`
      : `Copy was unavailable. Select the ${title} prompt text manually.`);
  };

  return <article className="package-preview" aria-label={`Combined prompts for ${artifact.originalDisplayName}`}>
    {artifacts.length > 1 ? <label className="artifact-selector">
      PACKAGE DOCUMENT
      <select
        aria-label="Package document"
        value={artifact.documentKey}
        onChange={(event) => onSelect(event.target.value)}
      >
        {artifacts.map((candidate) => <option key={candidate.documentKey} value={candidate.documentKey}>
          {candidate.originalDisplayName}
        </option>)}
      </select>
    </label> : null}
    <h3>{artifact.originalDisplayName}</h3>
    <section className="runbook-preview" aria-labelledby="package-runbook-heading">
      <h4 id="package-runbook-heading">PACKAGE RUNBOOK</h4>
      <pre><code>{artifact.runbookMarkdown}</code></pre>
    </section>
    <div className="prompt-preview-list">
      {artifact.promptBlocks.map((block) => <section className="prompt-preview-block" key={block.stage}>
        <header>
          <h4>{block.title.toUpperCase()}</h4>
          <button type="button" onClick={() => void copyPrompt(block.title, block.content)}>
            COPY {block.title.toUpperCase()}
          </button>
        </header>
        <pre><code>{block.content}</code></pre>
      </section>)}
    </div>
    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{copyStatus}</p>
  </article>;
}
