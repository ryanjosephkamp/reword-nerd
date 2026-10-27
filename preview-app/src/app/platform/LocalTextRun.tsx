import { mergeSavedReferences, stableSavedValue } from "../../workspace/references";
import { useWorkspaceState } from '../../workspace/Workspace';
import { localRequest, type LocalAction } from "./localClient";
import { useEffect, useState } from "react";
import type { StudioDocument } from "../studio/useStudio";
import {
  assessContext,
  DEFAULT_EXTRACTION_OPTIONS,
  resolveSettings,
  type ModelProfile,
  type RewriteSettings,
} from "../../domain";
import { buildPromptPackage } from "../../export";
import { renderPromptBundle } from "../../prompting";
export interface LocalTextSource {
  document: StudioDocument;
  settings: RewriteSettings;
  profile: ModelProfile;
}
interface Job {
  id: string;
  documentName: string;
  status: string;
  error?: string;
  stage?: string;
  location: string;
  sourceSha256: string;
  packageSha256: string;
  modelTurns: number;
  final: string | null;
  artifacts: string[];
  executor: { model: string; effort: string };
  runner: { stages: { stage: string; status: string }[] };
}
interface Capability {
  available: boolean;
  session: string;
  location: string;
  capabilities?: { model: string; effort: string; retention: string };
  mode?: string;
}
async function digest(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export function LocalTextRun({ source }: { source: LocalTextSource | null }) {
  const [cap, setCap] = useState<Capability | null>(null),
    [job, setJob] = useWorkspaceState<Job | null>("localText:job", null),
    [error, setError] = useState("");
  const [reviewed, setReviewed] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [associated, setAssociated] = useWorkspaceState<string | null>("localText:associated", null),
    [runBinding, setRunBinding] = useWorkspaceState<string | null>("localText:runBinding", null);
  const [history, setHistory] = useWorkspaceState<Job[]>("localText:history", []);
  const [freshJobId, setFreshJobId] = useState<string | null>(null);
  useEffect(() => { if (job) setHistory(prior => mergeSavedReferences(prior, [job])); }, [job, setHistory]);
  const document = source?.document;
  const fingerprint = source
    ? JSON.stringify([
        document?.id,
        document?.text,
        source.settings,
        source.profile,
      ])
    : "";
  useEffect(() => {
    let alive = true;
    localRequest("capabilities")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (alive && v?.capabilities?.kind === "reword-nerd-local-text")
          setCap(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!cap) return;
    let alive = true;
    const refresh = () =>
      localRequest("status")
        .then((r) => r.json())
        .then((v) => {
          if (alive) { setFreshJobId(v.job?.id ?? null); setJob(prior => v.job ? stableSavedValue(prior, v.job) : prior); }
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cap, setJob]);
  const supported = Boolean(
    document &&
    ["text", "markdown"].includes(document.format) &&
    document.status === "ready",
  );
  async function mutate(path: LocalAction, body?: Blob) {
    if (!cap) throw Error("Local companion unavailable");
    const r = await localRequest(path, cap.session, body);
    const v = await r.json();
    if (!r.ok) throw Error(v.error ?? "Local request failed");
    return v;
  }
  async function run() {
    if (!source || !supported || reviewed !== fingerprint || job) return;
    setBusy(true);
    setError("");
    try {
      const d = source.document,
        settings = resolveSettings(source.settings),
        profile = source.profile;
      const result = await buildPromptPackage([
        {
          kind: "document",
          documentId: d.id,
          documentName: d.name,
          documentFormat: d.format,
          original: d.original,
          reviewedExtractedText: d.text,
          resolvedSettings: settings,
          chosenProfile: profile,
          promptBundle: renderPromptBundle(d.text, settings, profile, {
            format: d.format,
            assets: [],
          }),
          warnings: [...d.warnings],
          contextAssessment: assessContext(d.text, profile.contextWindowTokens),
          reviewed: true,
          contextWarningAcknowledged: d.contextWarningAcknowledged,
          uploadOrdinal: 0,
          pageCount: d.pageCount ?? null,
          extractionOptions:
            d.extraction?.extractionOptions ?? DEFAULT_EXTRACTION_OPTIONS,
          visualAssets: [],
          ocrCandidates: [],
        },
      ]);
      if (!result.ok) throw Error(result.error.message);
      const response = await mutate("run", result.blob);
      setFreshJobId(response.job?.id ?? null); setJob(response.job);
      setRunBinding(fingerprint);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }
  async function action(path: LocalAction) {
    try {
      setError("");
      await mutate(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }
  async function associate() {
    if (!document || !job) return;
    if (
      runBinding !== fingerprint ||
      (await digest(document.text)) !== job.sourceSha256 ||
      document.name !== job.documentName
    ) {
      setError(
        "The selected source does not match this frozen run. The result remains available independently.",
      );
      return;
    }
    setAssociated(fingerprint);
  }
  if (!cap) return history.length || job ? <article className="runs-card"><h3>Saved text-job references</h3><p>These are recovered records. Reconnect the same companion for current status and artifact downloads. Recovery did not resume execution.</p>{(history.length ? history : [job!]).map(record => <details key={record.id}><summary>{record.documentName} · saved status {record.status}</summary><p>{record.id} · {record.modelTurns}/4 stage requests</p>{record.final !== null && <pre className="local-run-text">{record.final}</pre>}</details>)}</article> : null;
  return (
    <article
      className="runs-card local-text-run"
      aria-label="Connected local text"
    >
      <span className="studio-eyebrow">
        LOCAL COMPANION · {cap.capabilities?.model} / {cap.capabilities?.effort}
      </span>
      <h2>Run reviewed text</h2>
      {cap.mode === "review-only" && (
        <p role="status">
          Review-only launch. No host is initialized and new execution is
          disabled.
        </p>
      )}
      <p>
        One TXT or Markdown document. Decompose → Rewrite → Verify → Final. No
        inter-stage copying.
      </p>
      <p className="runs-caption">
        Explicit Run sends the frozen text to your authenticated Codex host.{" "}
        {cap.capabilities?.retention}
      </p>
      <details>
        <summary>Local job location</summary>
        <code style={{ overflowWrap: "anywhere" }}>{cap.location}</code>
        <p>
          Keep this folder for recovery. No automatic cleanup is performed.
          Remove it yourself after closing its companion and preserving any
          results you need.
        </p>
      </details>
      {!job && (
        <>
          <p>
            <strong>Selected source:</strong>{" "}
            {document?.name ?? "Select a document in Text"}
          </p>
          {!supported && (
            <p role="status">
              Select and confirm a TXT/Markdown document in Text. PDF, code,
              projects, OCR and image execution remain manual.
            </p>
          )}
          {supported && (
            <details open>
              <summary>Frozen source preview</summary>
              <pre className="local-run-text">{document?.text}</pre>
            </details>
          )}
          <label className="local-run-confirm">
            <input
              type="checkbox"
              checked={reviewed === fingerprint && Boolean(fingerprint)}
              disabled={!supported || busy}
              onChange={(e) =>
                setReviewed(e.target.checked ? fingerprint : null)
              }
            />{" "}
            I reviewed this exact source and settings and want to run all four
            stages.
          </label>
          <button
            className="studio-primary"
            disabled={
              !cap.available || !supported || reviewed !== fingerprint || busy
            }
            onClick={() => void run()}
          >
            {busy ? "Preparing frozen snapshot…" : "Run four stages"}
          </button>
        </>
      )}
      {job && (
        <>
          <p role="status" aria-live="polite">
            <strong>{job.status}</strong> · {job.stage ?? "prepared"} ·{" "}
            {job.modelTurns}/4 stage requests
          </p>
          {runBinding !== fingerprint && (
            <p>
              The current selection is not the frozen run snapshot. Results stay
              independent.
            </p>
          )}
          <ul>
            {job.runner.stages.map((s) => (
              <li key={s.stage}>
                {s.stage}: {s.status}
              </li>
            ))}
          </ul>
          {job.error && <p role="alert">{job.error}</p>}
          {job.status === "running" && (
            <button
              className="studio-secondary"
              disabled={freshJobId !== job.id}
              onClick={() => void action("cancel")}
            >
              Cancel this run
            </button>
          )}
          {["interrupted", "failed"].includes(job.status) && (
            <button
              className="studio-secondary"
              disabled={freshJobId !== job.id}
              onClick={() => void action("resume")}
            >
              Check safe resume
            </button>
          )}
          {job.final !== null && (
            <>
              <h3>Returned final document · awaiting your review</h3>
              <pre className="local-run-text" tabIndex={0}>
                {job.final}
              </pre>
              <p>
                Generation does not establish factual correctness or your
                acceptance. Run does not replace your source.
              </p>
              <button
                className="studio-secondary"
                onClick={() => void associate()}
              >
                Associate with matching selected source
              </button>
              {associated && (
                <p>
                  {associated === fingerprint
                    ? "Explicitly associated with this unchanged source."
                    : "Association is stale because the selected source or settings changed. The result is retained independently."}
                </p>
              )}
            </>
          )}
          <div className="local-run-downloads">
            {job.artifacts.map((name) => (
              freshJobId === job.id ? <a key={name} href={"/api/artifact/" + name} download>{name}</a> : <span key={name}>{name} · reconnect its companion to download</span>
            ))}
          </div>
          <details>
            <summary>Run identity</summary>
            <code style={{ overflowWrap: "anywhere" }}>
              Source SHA-256: {job.sourceSha256}
              <br />
              Package SHA-256: {job.packageSha256}
            </code>
          </details>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
