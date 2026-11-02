import { useMemo } from "react";
import {
  STAGES,
  buildStagePrompt,
  fillStagePrompt,
  type Stage,
  type TextBatch,
} from "../../engine/handoff/textPrompt";
import { CopyButton } from "../../ui/CopyButton";
import { scopedSources } from "../batch";
import { useWorkspace } from "../store";

const STAGE_INFO: Record<Stage, { title: string; summary: string }> = {
  decompose: { title: "Decompose", summary: "Lists everything the rewrite must keep." },
  rewrite: { title: "Rewrite", summary: "Writes a new version in different words." },
  verify: { title: "Verify", summary: "Checks the rewrite for anything lost, added, or changed." },
  final: { title: "Final", summary: "Fixes what the check found and finishes the document." },
};

export function StepByStep({ batch }: { batch: TextBatch }) {
  const job = useWorkspace((state) => state.job);
  const replies = useWorkspace((state) => state.stageReplies);
  const setStageReply = useWorkspace((state) => state.setStageReply);
  const textResult = useWorkspace((state) => state.textResult);
  const setTextResult = useWorkspace((state) => state.setTextResult);
  const sources = useWorkspace((state) => state.sources);
  const scope = useWorkspace((state) => state.scope);
  const selectedId = useWorkspace((state) => state.selectedSourceId);
  const prompts = useMemo(
    () => Object.fromEntries(STAGES.map((stage) => [stage, buildStagePrompt(batch, job, stage)])),
    [batch, job],
  ) as Record<Stage, string>;

  return (
    <ol className="stage-list">
      {STAGES.map((stage, index) => {
        const earlier = STAGES.slice(0, index) as Exclude<Stage, "final">[];
        const ready = earlier.every((previous) => replies[previous]?.trim());
        const reply = stage === "final" ? (textResult?.reply ?? "") : (replies[stage] ?? "");
        return (
          <li key={stage} className={`stage ${ready ? "" : "stage-waiting"}`}>
            <div className="stage-head">
              <span className="stage-number">{index + 1}</span>
              <div>
                <p className="step-title">{STAGE_INFO[stage].title}</p>
                <p className="muted small">{STAGE_INFO[stage].summary}</p>
              </div>
            </div>
            <CopyButton
              text={() => fillStagePrompt(prompts[stage], stage, replies)}
              label={`Copy prompt ${index + 1}`}
              className="btn"
              disabled={!ready}
            />
            {!ready && <p className="muted small">Paste the reply from step {index} first.</p>}
            <label className="field">
              <span className="field-label">
                {stage === "final" ? "Paste the final reply" : `Paste reply ${index + 1}`}
              </span>
              <textarea
                rows={3}
                value={reply}
                disabled={!ready}
                onChange={(event) => {
                  const value = event.target.value;
                  if (stage !== "final") setStageReply(stage, value);
                  else
                    setTextResult(
                      value.trim()
                        ? {
                            sourceIds: scopedSources(sources, scope, selectedId).map(
                              (source) => source.id,
                            ),
                            reply: value,
                            files: null,
                            report: null,
                          }
                        : null,
                    );
                }}
              />
            </label>
          </li>
        );
      })}
    </ol>
  );
}
