import type { ContextAssessment } from "../../../domain";

interface ContextMeterProps {
  assessment: ContextAssessment;
  acknowledged: boolean;
  onAcknowledge(checked: boolean): void;
}

export function ContextMeter({ assessment, acknowledged, onAcknowledge }: ContextMeterProps) {
  const actualPercent = assessment.ratio === null ? null : Math.round(assessment.ratio * 100);
  const fill = actualPercent === null ? 0 : Math.min(100, Math.max(0, actualPercent));
  return <section className={`context-meter${assessment.oversized ? " is-oversized" : ""}`} aria-label="Context estimate">
    <div className="meter-copy">
      <span>ESTIMATE: ~{assessment.workflowTokens.toLocaleString()} TOKENS</span>
      <span>{actualPercent === null ? "UNKNOWN" : `${actualPercent}%`}</span>
    </div>
    {assessment.ratio === null ? <p>Context estimate unavailable for this profile.</p> : <div
      className="meter-track"
      role="meter"
      aria-label="Estimated model context usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fill}
      aria-valuetext={`${actualPercent}% of selected profile context`}
    ><span style={{ width: `${fill}%` }} /></div>}
    {assessment.oversized ? <div className="context-warning">
      <p>Estimated workflow context exceeds the selected profile.</p>
      <label><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.currentTarget.checked)} />I understand and want to include this file.</label>
    </div> : null}
  </section>;
}
