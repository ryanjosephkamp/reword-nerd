import { HarnessHandoff } from "./HarnessHandoff";
import { LocalTextRun, type LocalTextSource } from "./LocalTextRun";
import { LocalImagePreparation } from "./LocalImagePreparation";
import { ReviewImports } from "./reviews/ReviewImports";
import type { ImagePortalState } from "../../image/reducer";
import { useState } from "react";
import {
  Check,
  Copy,
  TerminalWindow,
  ShieldCheck,
  ArrowRight,
} from "@phosphor-icons/react";
import { copyText } from "../workbench/copyText";
import { CollectionRun } from "./CollectionRun";
import type { TextCandidate } from "./collectionSources";
const command =
  "Run the reviewed text package at /absolute/path/package.zip through Decompose → Rewrite → Verify → Final. Use the current host, preserve the package profile, and present the exported result for my review.";
export function Runs({
  imageState = null,
  localSource = null,
  collectionSources = [],
}: {
  imageState?: ImagePortalState | null;
  localSource?: LocalTextSource | null;
  collectionSources?: TextCandidate[];
}) {
  const [copied, setCopied] = useState(false);
  return (
    <main className="platform-runs">
      <aside className="runs-sidebar">
        <span className="studio-eyebrow">EXECUTION</span>
        <h2>Local companion</h2>
        <p>
          The browser prepares packages and inspects explicitly imported
          reviews. Your Codex host runs the supported text workflow.
        </p>
        <a className="runs-workflow-link" href="#runs-host-workflow">
          Open host workflow ↓
        </a>
        <div className="runs-boundary">
          <ShieldCheck size={22} />
          <strong>Explicit local execution</strong>
          <p>
            The static site cannot start local jobs. A companion served from its
            own local address can expose a supported text run below. No
            credentials are requested.
          </p>
        </div>
      </aside>
      <section className="runs-content">
        <span className="studio-eyebrow">REVIEWED SOURCE → FINAL ARTIFACT</span>
        <h1>Review run artifacts.</h1>
        <p className="runs-lede">
          Import a portable image review for inspection, or use the local text
          companion to carry a reviewed document through all four stages.
        </p>
        <CollectionRun sources={collectionSources} imageState={imageState} />
        <details><summary>Earlier single-document and image records</summary>
        <HarnessHandoff imageState={imageState} source={localSource} />
        <LocalTextRun source={localSource} />
        </details>
        <LocalImagePreparation imageState={imageState} />
        <ReviewImports imageState={imageState} />
        <div className="runs-stage-list">
          {["Decompose", "Rewrite", "Verify", "Final"].map((stage, i) => (
            <span key={stage}>
              <small>0{i + 1}</small>
              {stage}
              {i < 3 && <ArrowRight size={15} />}
            </span>
          ))}
        </div>
        <article className="runs-card" id="runs-host-workflow">
          <h2>Use your current Codex host</h2>
          <ol>
            <li>
              Review one TXT or Markdown document in Text, then build and
              download its package.
            </li>
            <li>
              Open this repository in Codex and select the ZIP once with the
              included canonical instructions.
            </li>
            <li>
              Review the final Markdown, raw responses, audit record and
              standalone progress workbook.
            </li>
          </ol>
          <pre>{command}</pre>
          <button
            className="studio-primary"
            onClick={async () =>
              setCopied((await copyText(command)) === "copied")
            }
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
            {copied ? "Copied" : "Copy host instruction"}
          </button>
          <p className="runs-caption">
            This copies an instruction. It does not start a run.
          </p>
        </article>
        <article className="runs-card">
          <h2>
            <TerminalWindow size={20} /> Inspect or resume from a terminal
          </h2>
          <pre>
            {
              "node companion/cli.mjs inspect /absolute/path/package.zip\nnode companion/cli.mjs status --job /absolute/path/job"
            }
          </pre>
          <p>
            Run these commands from this checkout. The package README describes the canonical workflow. The companion
            provides prepare, next, record-response, and export commands.
          </p>

        </article>
      </section>
      <aside className="runs-details">
        <span className="studio-eyebrow">RUN DETAILS</span>
        <h2>Supported today</h2>
        <dl>
          <dt>Input</dt>
          <dd>
            Portable retained-image review v1; schema 6 text packages use the
            local companion.
          </dd>
          <dt>Custody</dt>
          <dd>
            Package, reviewed source, prompt and response hashes; stage history
            and stale-response checks
          </dd>
          <dt>Execution</dt>
          <dd>
            Four aggregate text stages with item-bound canonical tasks, or one
            Codex task for selected PNG renditions. Availability depends on the
            enabled and verified local adapter.
          </dd>
          <dt>Acceptance</dt>
          <dd>
            Model verification and your edits remain distinct. Final acceptance
            is yours.
          </dd>
        </dl>
        <div className="runs-boundary">
          <strong>Images and projects</strong>
          <p>
            Manual review and package export remain available. Reviewed projects
            deliver indexed text and return proposed file contents for review.
            Image outputs and review remain in Codex. Nothing is applied to a repository.
          </p>
        </div>
        <p className="runs-caption">
          Saved model profiles configure prompts. They do not authenticate a
          provider or establish the executor’s identity.
        </p>
      </aside>
    </main>
  );
}
