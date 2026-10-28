import {
  FORMALITY_LABELS,
  GOALS,
  LENGTH_LABELS,
  MAX_NOTES_LENGTH,
  TONE_LABELS,
  type Formality,
  type Goal,
  type Length,
  type Tone,
} from "../../engine/job";
import { Segmented } from "../../ui/Segmented";
import { useWorkspace } from "../store";

const GOAL_ORDER: Goal[] = ["clear", "polish", "academic", "custom"];
const CODE_FORMATS = new Set([
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

function options<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

const SHORT_TONES: Record<Tone, string> = { ...TONE_LABELS, original: "Original" };
const SHORT_FORMALITY: Record<Formality, string> = { ...FORMALITY_LABELS, original: "Original" };
const SHORT_LENGTH: Record<Length, string> = { ...LENGTH_LABELS, original: "Same" };

export function JobPanel() {
  const job = useWorkspace((state) => state.job);
  const setJob = useWorkspace((state) => state.setJob);
  const setGoal = useWorkspace((state) => state.setGoal);
  const hasCode = useWorkspace((state) =>
    state.sources.some(
      (source) => source.included && (CODE_FORMATS.has(source.format) || source.projectId !== null),
    ),
  );

  const summary = [
    SHORT_TONES[job.tone] === "Original" ? "Original tone" : SHORT_TONES[job.tone],
    SHORT_FORMALITY[job.formality] === "Original"
      ? "original formality"
      : SHORT_FORMALITY[job.formality].toLowerCase(),
    job.length === "original" ? "same length" : SHORT_LENGTH[job.length].toLowerCase(),
    job.outputLanguage.trim() || null,
    job.notes.trim() ? "notes" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="panel-section" aria-labelledby="job-heading">
      <h2 id="job-heading" className="section-title">
        Set the rewrite
      </h2>

      <fieldset className="goal-grid">
        <legend className="visually-hidden">Goal</legend>
        {GOAL_ORDER.map((goal) => (
          <label key={goal} className={`goal-card ${job.goal === goal ? "goal-card-on" : ""}`}>
            <input
              type="radio"
              name="goal"
              value={goal}
              checked={job.goal === goal}
              onChange={() => setGoal(goal)}
            />
            <span className="goal-label">{GOALS[goal].label}</span>
            <span className="goal-summary">{GOALS[goal].summary}</span>
          </label>
        ))}
      </fieldset>

      <details className="fine-tune" open={job.goal === "custom"}>
        <summary>
          <span className="field-label">Fine-tune</span>
          <span className="muted small">{summary}</span>
        </summary>
        <div className="stack">
          <Segmented
            label="Tone"
            value={job.tone}
            options={options(SHORT_TONES)}
            onChange={(tone) => setJob({ tone })}
          />
          <Segmented
            label="Formality"
            value={job.formality}
            options={options(SHORT_FORMALITY)}
            onChange={(formality) => setJob({ formality })}
          />
          <Segmented
            label="Length"
            value={job.length}
            options={options(SHORT_LENGTH)}
            onChange={(length) => setJob({ length })}
          />

          <label className="field">
            <span className="field-label">Output language</span>
            <input
              type="text"
              value={job.outputLanguage}
              placeholder="Same as the source"
              onChange={(event) => setJob({ outputLanguage: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">Anything else?</span>
            <textarea
              rows={3}
              maxLength={MAX_NOTES_LENGTH}
              value={job.notes}
              placeholder="For example: keep it under 500 words, or use British spelling."
              onChange={(event) => setJob({ notes: event.target.value })}
            />
          </label>
        </div>
      </details>

      {hasCode && (
        <fieldset className="checks">
          <legend className="field-label">In code and data files, rewrite</legend>
          {(
            [
              ["docsAndMarkup", "Documentation and markup text"],
              ["comments", "Comments and docstrings"],
              ["userFacingStrings", "Text users see (messages, labels)"],
              ["dataValues", "Prose inside data files"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={job.codeScope[key]}
                onChange={(event) =>
                  setJob({ codeScope: { ...job.codeScope, [key]: event.target.checked } })
                }
              />
              <span>{label}</span>
            </label>
          ))}
          <p className="muted small">Code itself, names, and keys never change.</p>
        </fieldset>
      )}
    </section>
  );
}
