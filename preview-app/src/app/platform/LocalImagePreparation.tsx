import { useWorkspaceState } from '../../workspace/Workspace';
import { useEffect, useState } from "react";
import type { ImagePortalState } from "../../image/reducer";
import { localRequest } from "./localClient";
interface Capability {
  kind: string;
  session: string;
  generationAvailable: false;
  observationDate: string;
  interfaceVersion: string;
  providerImageGenerationAdvertised: boolean;
  referenceInput: string;
  resultTransport: string;
  boundary: string;
  reason: string;
  location: string;
}
interface ImageJob {
  jobId: string;
  packageSha256: string;
  pairKey: string;
  referenceSha256: string;
  promptSha256: string;
  location: string;
  status: string;
  blocker: string;
  artifacts: string[];
  execution: { host: string; model: string | null };
  savedConfiguration: unknown;
  attempts: {
    ticket: { ticketId: string; attempt: number; revision: number };
    status: string;
  }[];
}
export function LocalImagePreparation({
  imageState,
}: {
  imageState: ImagePortalState | null;
}) {
  const [cap, setCap] = useState<Capability | null>(null),
    [job, setJob] = useWorkspaceState<ImageJob | null>("imagePreparation:job", null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState<string | null>(null);
  const built = imageState?.builtOutput ?? null;
  useEffect(() => {
    let alive = true;
    void localRequest("imageCapabilities")
      .then((r) => (r.ok ? r.json() : null))
      .then(async (c) => {
        if (!alive || c?.kind !== "reword-local-image-preparation") return;
        setCap(c);
        const r = await localRequest("imageStatus");
        const s = await r.json();
        if (alive) {
          if (r.ok) setJob(s.job);
          else
            setError(
              s.error ?? "The saved image preparation could not be validated.",
            );
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [setJob]);
  async function prepare() {
    if (!built || !cap || confirmed !== built.packageSha256) return;
    setBusy(true);
    setError("");
    try {
      const r = await localRequest(
        "imagePrepare",
        cap.session,
        built.packageBytes,
      );
      const value = await r.json();
      if (!r.ok) throw Error(value.error ?? "Image preparation failed");
      setJob(value.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image preparation failed");
    } finally {
      setBusy(false);
    }
  }
  if (!cap) return job ? <article className="runs-card"><h3>Saved image-preparation reference</h3><p>{job.jobId} · saved status {job.status}</p><p>Reconnect its companion for current records and downloads. No image generation was resumed.</p></article> : null;
  return (
    <article
      className="runs-card local-image-preparation"
      aria-label="Local image preparation"
    >
      <span className="studio-eyebrow">
        IMAGE CONNECTION · OFFLINE PREPARATION
      </span>
      <h2>Prepare an image job</h2>
      <p>
        Validate a built image package and preserve its exact reference, prompt
        and ticket locally. This action does not generate an image.
      </p>
      <p role="status">
        <strong>Direct image-job execution unavailable.</strong> {cap.reason}{" "}
        The separate Send to harness workflow can deliver a reviewed PNG to an
        explicitly enabled Codex terminal task.
      </p>
      <details>
        <summary>Recorded capability evidence · {cap.observationDate}</summary>
        <p>
          Official interface {cap.interfaceVersion}. Provider advertises image
          generation: {cap.providerImageGenerationAdvertised ? "yes" : "no"}.
          This is a recorded observation, not a live capability check or
          authentication claim for this launch.
        </p>
        <p>{cap.referenceInput}</p>
        <p>{cap.resultTransport}</p>
        <p>{cap.boundary}</p>
        <p>No model or image request is authorized by preparation.</p>
      </details>
      {!job && (
        <>
          <p>
            In Images, review one PNG and build its package. The existing manual
            export remains available. Accepted OCR, multiple images and other
            formats are outside this local validator.
          </p>
          <p>
            Built package:{" "}
            {built
              ? `${built.itemCount} image(s) · ${built.packageByteCount.toLocaleString()} bytes`
              : "No current package"}
          </p>
          <label className="local-run-confirm">
            <input
              type="checkbox"
              disabled={!built || busy}
              checked={Boolean(built) && confirmed === built?.packageSha256}
              onChange={(e) =>
                setConfirmed(
                  e.target.checked ? (built?.packageSha256 ?? null) : null,
                )
              }
            />{" "}
            Preserve this reviewed image package in a local job folder. Do not
            generate an image.
          </label>
          <button
            className="studio-primary"
            disabled={!built || confirmed !== built.packageSha256 || busy}
            onClick={() => void prepare()}
          >
            {busy
              ? "Validating image package…"
              : "Prepare locally — no generation"}
          </button>
        </>
      )}
      {job && (
        <>
          <h3>Prepared locally · execution blocked</h3>
          <p>
            No image was generated or accepted. The unsupported ticket preserves
            the current boundary; it does not authorize a future attempt.
          </p>
          {built?.packageSha256 !== job.packageSha256 && (
            <p>
              The current image package differs or is no longer built. This
              prepared job remains independent.
            </p>
          )}
          <dl>
            <dt>Job</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{job.jobId}</dd>
            <dt>Reference SHA-256</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{job.referenceSha256}</dd>
            <dt>Prompt SHA-256</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{job.promptSha256}</dd>
          </dl>
          <ul>
            {job.attempts.map((a) => (
              <li key={a.ticket.ticketId}>
                Attempt {a.ticket.attempt} · revision {a.ticket.revision} ·{" "}
                {a.status}
              </li>
            ))}
          </ul>
          <div className="local-run-downloads">
            {job.artifacts.map((name) => (
              <a key={name} href={"/api/image/artifact/" + name} download>
                {name}
              </a>
            ))}
          </div>
          <details>
            <summary>Saved configuration and preparation location</summary>
            <pre className="local-run-text">
              {JSON.stringify(job.savedConfiguration, null, 2)}
            </pre>
            <code style={{ overflowWrap: "anywhere" }}>{job.location}</code>
          </details>
        </>
      )}
      <p className="runs-caption">
        Explicit preparation writes a local folder under {cap.location}. It
        persists until you remove it after closing its companion. Browser image
        queues can be saved through workspace options. No credentials are requested; checksums
        establish consistency, not authorship.
      </p>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
