import { ArrowSquareOut } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { buildTextTaskZip } from "../../engine/handoff/agentTask";
import { DESTINATIONS, destination, type Destination } from "../../engine/handoff/destinations";
import { buildOnePrompt } from "../../engine/handoff/textPrompt";
import { estimateTokens } from "../../engine/text";
import { CopyButton } from "../../ui/CopyButton";
import { Dialog } from "../../ui/Dialog";
import { Segmented } from "../../ui/Segmented";
import { buildBatch, buildTaskInput, scopedSources } from "../batch";
import { DestinationPicker } from "../shared/DestinationPicker";
import { TaskSteps } from "../shared/TaskSteps";
import { useWorkspace } from "../store";
import { BringBack } from "./BringBack";
import { StepByStep } from "./StepByStep";

/** Past this size a single chat paste gets unreliable; agents and step-by-step cope better. */
const LONG_FOR_CHAT_TOKENS = 40_000;

const TEXT_DESTINATIONS = DESTINATIONS.filter((candidate) => candidate.forText);

function AgentSteps({ target }: { target: Destination }) {
  const sources = useWorkspace((state) => state.sources);
  const projects = useWorkspace((state) => state.projects);
  const scope = useWorkspace((state) => state.scope);
  const selectedId = useWorkspace((state) => state.selectedSourceId);
  const job = useWorkspace((state) => state.job);
  const input = useMemo(
    () => buildTaskInput(scopedSources(sources, scope, selectedId), projects),
    [sources, projects, scope, selectedId],
  );
  return (
    <TaskSteps
      target={target}
      title={input.batch.title}
      build={(slug) => buildTextTaskZip(input, job, slug)}
      what="It holds your files, the rewrite instructions, and empty folders for the results."
    />
  );
}

function ChatSteps({ target }: { target: Destination }) {
  const sources = useWorkspace((state) => state.sources);
  const projects = useWorkspace((state) => state.projects);
  const scope = useWorkspace((state) => state.scope);
  const selectedId = useWorkspace((state) => state.selectedSourceId);
  const job = useWorkspace((state) => state.job);
  const stepByStep = useWorkspace((state) => state.stepByStep);
  const setStepByStep = useWorkspace((state) => state.setStepByStep);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const scoped = useMemo(
    () => scopedSources(sources, scope, selectedId),
    [sources, scope, selectedId],
  );
  const batch = useMemo(() => buildBatch(scoped, projects), [scoped, projects]);
  const prompt = useMemo(() => buildOnePrompt(batch, job), [batch, job]);
  const tokens = useMemo(() => estimateTokens(prompt), [prompt]);

  function copyAndOpen() {
    // Start the copy inside the click so the browser still treats it as the user's action.
    navigator.clipboard.writeText(prompt).then(
      () => setCopied("copied"),
      () => setCopied("failed"),
    );
  }

  return (
    <div className="stack">
      {tokens > LONG_FOR_CHAT_TOKENS && (
        <p className="callout callout-warn">
          This prompt is long for a chat app (about {tokens.toLocaleString("en-US")} tokens). A
          coding agent handles big jobs better, or go step by step.
        </p>
      )}
      {!stepByStep && (
        <>
          <div className="button-row">
            {target.url ? (
              <a
                className="btn btn-primary"
                href={target.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={copyAndOpen}
              >
                <ArrowSquareOut aria-hidden />
                <span>Copy prompt and open {target.label}</span>
              </a>
            ) : (
              <CopyButton text={prompt} label="Copy prompt" className="btn btn-primary" />
            )}
            {target.url && <CopyButton text={prompt} label="Copy only" />}
            <button type="button" className="link-button" onClick={() => setPreview(true)}>
              See the prompt
            </button>
          </div>
          {copied === "copied" && (
            <p className="callout" role="status">
              Prompt copied. Paste it into a new chat in {target.label}.
            </p>
          )}
          {copied === "failed" && (
            <p className="callout callout-error" role="alert">
              The browser didn't allow copying. Use “See the prompt” and copy it from there.
            </p>
          )}
          <p className="muted small">
            One prompt runs all four stages: decompose, rewrite, verify, and final. About{" "}
            {tokens.toLocaleString("en-US")} tokens.
          </p>
        </>
      )}
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={stepByStep}
          onChange={(event) => setStepByStep(event.target.checked)}
        />
        <span>
          <strong>Go step by step</strong>
          <span className="muted small">
            Four prompts, one per stage, so you can check each reply. Best for long or delicate
            documents.
          </span>
        </span>
      </label>
      {stepByStep && <StepByStep batch={batch} />}
      <Dialog open={preview} title="The prompt" onClose={() => setPreview(false)} wide>
        <div className="stack">
          <CopyButton text={prompt} label="Copy prompt" className="btn btn-primary" />
          <pre className="prompt-preview">{prompt}</pre>
        </div>
      </Dialog>
    </div>
  );
}

export function HandoffPanel() {
  const destinationId = useWorkspace((state) => state.textDestination);
  const setDestination = useWorkspace((state) => state.setTextDestination);
  const scope = useWorkspace((state) => state.scope);
  const setScope = useWorkspace((state) => state.setScope);
  const includedCount = useWorkspace(
    (state) => state.sources.filter((source) => source.included).length,
  );
  const selectedIncluded = useWorkspace((state) =>
    state.sources.some((source) => source.id === state.selectedSourceId && source.included),
  );
  const target = destination(destinationId);
  const ready = scope === "selected" ? selectedIncluded : includedCount > 0;

  return (
    <section className="panel-section" aria-labelledby="handoff-heading">
      <h2 id="handoff-heading" className="section-title">
        Hand it off
      </h2>
      <DestinationPicker
        name="text-destination"
        value={target}
        options={TEXT_DESTINATIONS}
        groups={[
          { kind: "agent", label: "Coding agents" },
          { kind: "chat", label: "Chat apps" },
        ]}
        onChange={(next) => setDestination(next.id)}
      />
      {includedCount > 1 && (
        <Segmented
          label="What to send"
          value={scope}
          options={[
            { value: "all", label: `All included (${includedCount})` },
            { value: "selected", label: "Only this file" },
          ]}
          onChange={setScope}
        />
      )}
      {!ready ? (
        <p className="muted">
          {scope === "selected"
            ? "This file isn't included. Tick it in the file list, or send all included files."
            : "Include at least one file to hand off."}
        </p>
      ) : target.kind === "agent" ? (
        <AgentSteps target={target} />
      ) : (
        <ChatSteps target={target} />
      )}
      {ready && <BringBack kind={target.kind === "agent" ? "agent" : "chat"} />}
    </section>
  );
}
