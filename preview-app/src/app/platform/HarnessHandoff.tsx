import { mergeSavedReferences } from "../../workspace/references";
import { useWorkspaceState } from '../../workspace/Workspace';
import { useEffect, useRef, useState } from "react";
import type { ImagePortalState } from "../../image/reducer";
import type { LocalTextSource } from "./LocalTextRun";
import { localTextPackage } from "./localTextPackage";
import { handoffRequest } from "./handoffClient";
interface Capability {
  kind: string;
  session: string;
  terminalReviewAvailable: boolean;
  terminalTaskAvailable?: boolean;
  terminalMode?: string;
  activeHandoffId?: string | null;
  agentTestBudgetSpent?: boolean;
  reason: string;
  version: string | null;
  location: string;
  claude: { available: false; reason: string };
}
interface Handoff {
  id: string;
  sourceKind: "image" | "text";
  resendOf?: string | null;
  displayName: string;
  phase: string;
  error?: string;
  boundaryNote?: string | null;
  prompt: string;
  promptSha256: string;
  referenceSha256: string;
  packageSha256: string;
  snapshotSha256: string;
  workflow: string;
  location: string;
  events: {
    file: string;
    taskId?: string;
    actualExecutor?: string;
    actualModel?: string | null;
    actualEffort?: string | null;
    requestedModel?: string;
    requestedEffort?: string;
  }[];
  artifacts: string[];
}
export function HarnessHandoff({
  imageState,
  source,
}: {
  imageState: ImagePortalState | null;
  source: LocalTextSource | null;
}) {
  const [cap, setCap] = useState<Capability | null>(null),
    [kind, setKind] = useWorkspaceState<"text" | "image">("handoff:kind", "image"),
    [reviewed, setReviewed] = useState<string | null>(null),
    [records, setRecords] = useWorkspaceState<Handoff[]>("handoff:records", []),
    [selected, setSelected] = useWorkspaceState<string | null>("handoff:selected", null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preparedBinding, setPreparedBinding] = useWorkspaceState<Record<string, string>>("handoff:preparedBinding",
      {},
    ),
    [outgoingReview, setOutgoingReview] = useState<string | null>(null);
  const requests = useRef(new Map<string, string>());
  const frozenTextPackages = useRef(new Map<string, Blob>());
  const built = imageState?.builtOutput ?? null;
  const fingerprint =
    kind === "image"
      ? (built?.packageSha256 ?? "")
      : source
        ? JSON.stringify([
            source.document.id,
            source.document.name,
            source.document.format,
            source.document.text,
            source.settings,
            source.profile,
          ])
        : "";
  const supported =
    kind === "image"
      ? Boolean(built)
      : Boolean(
          source &&
          source.document.status === "ready" &&
          ["text", "markdown"].includes(source.document.format),
        );
  useEffect(() => {
    let alive = true;
    void handoffRequest("capabilities")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (alive && c?.kind === "reword-outbound-handoff") setCap(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const capabilitySession = cap?.session;
  useEffect(() => {
    if (!capabilitySession) return;
    let alive = true;
    const refresh = () =>
      void handoffRequest("status")
        .then((r) => r.json())
        .then((s) => {
          if (alive && Array.isArray(s.handoffs))
            setRecords((prev) => {
              const incoming = s.handoffs as Handoff[];
              return mergeSavedReferences(prev, [
                ...incoming.map((next) => {
                  const old = prev.find((x) => x.id === next.id);
                  return old &&
                    !next.error &&
                    (old.events?.length ?? 0) > (next.events?.length ?? 0)
                    ? old
                    : next;
                }),
                ...prev.filter((x) => !incoming.some((n) => n.id === x.id)),
              ]);
            });
        })
        .catch(() => {});
    refresh();
    const refreshCapability = () =>
      void handoffRequest("capabilities")
        .then((r) => (r.ok ? r.json() : null))
        .then((c) => {
          if (alive && c?.kind === "reword-outbound-handoff") setCap(c);
        })
        .catch(() => {
          if (alive)
            setCap((c) =>
              c
                ? {
                    ...c,
                    terminalTaskAvailable: false,
                    reason:
                      "Capability refresh failed. No task start until status is available.",
                  }
                : c,
            );
        });
    const timer = setInterval(() => {
      refresh();
      refreshCapability();
    }, 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [capabilitySession, setRecords]);
  async function prepare(resendOf?: string) {
    if (!cap || !supported || reviewed !== fingerprint) return;
    setBusy(true);
    setError("");
    try {
      const key = fingerprint + (resendOf ?? "");
      let id = requests.current.get(key);
      if (!id) {
        id = crypto.randomUUID();
        requests.current.set(key, id);
      }
      let bytes =
        kind === "image"
          ? built!.packageBytes
          : frozenTextPackages.current.get(fingerprint);
      if (!bytes) {
        if (frozenTextPackages.current.size >= 16)
          throw Error(
            "This tab retains at most 16 frozen text handoffs. Export your work before starting a new session.",
          );
        bytes = await localTextPackage(source!);
        const retained = [...frozenTextPackages.current.values()].reduce(
          (total, blob) => total + blob.size,
          0,
        );
        if (retained + bytes.size > 32 * 1024 * 1024)
          throw Error(
            "Frozen handoffs exceed this tab's 32 MiB limit. Export your work before starting a new session.",
          );
        frozenTextPackages.current.set(fingerprint, bytes);
      }
      const r = await handoffRequest("prepare", {
        session: cap.session,
        body: bytes,
        kind,
        requestId: id,
        resendOf,
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error ?? "Preparation failed");
      setRecords((prev) => [
        v.handoff,
        ...prev.filter((x) => x.id !== v.handoff.id),
      ]);
      setSelected(v.handoff.id);
      setPreparedBinding((prev) => ({ ...prev, [v.handoff.id]: fingerprint }));
      setOutgoingReview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preparation failed");
    } finally {
      setBusy(false);
    }
  }
  const chosen = records.find((x) => x.id === selected) ?? null;
  const matches = Boolean(
    chosen &&
    chosen.sourceKind === kind &&
    preparedBinding[chosen.id] === fingerprint,
  );
  async function open(task = false) {
    if (!chosen || !cap || outgoingReview !== chosen.snapshotSha256 || !matches)
      return;
    setBusy(true);
    setError("");
    try {
      const r = await handoffRequest(task ? "dispatch" : "open", {
        session: cap.session,
        body: new Blob(
          [
            JSON.stringify({
              id: chosen.id,
              snapshotSha256: chosen.snapshotSha256,
            }),
          ],
          { type: "application/json" },
        ),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error ?? "Launch review could not be opened");
      setRecords((prev) =>
        prev.map((x) => (x.id === chosen.id ? v.handoff : x)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch outcome unknown");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="runs-card harness-handoff" aria-label="Send to harness">
      <span className="studio-eyebrow">SEND TO HARNESS</span>
      <h2>Review a Codex handoff.</h2>
      <p>
        Review the exact prepared prompt and original reference, then confirm a
        new Codex terminal task. Codex owns execution and output review. Task
        start requires an explicitly enabled local companion.
      </p>
      {!cap?.terminalTaskAvailable && (
        <p>Codex task start is unavailable in this launch.</p>
      )}
      {!cap ? (
        <p>
          The optional local companion provides this handoff. The static site
          retains manual exports; it cannot launch desktop tasks.
        </p>
      ) : (
        <>
          <p role="status">
            <strong>Codex terminal.</strong> {cap.reason} This is a terminal
            workflow, not a desktop-chat draft.
          </p>
          <details>
            <summary>Target capabilities and limits</summary>
            <p>
              Installed interface: {cap.version ?? "unavailable"}. The launcher
              uses official prompt and original PNG input. The previous image
              handoff completed a real task. This launch checks supported
              existing ChatGPT sign-in before dispatch; saved profiles are not
              authentication. Actual model/version is reported only when
              exposed. Codex may perform multiple internal operations. Output
              review remains in Codex.
            </p>
            <p>Claude Code: {cap.claude.reason}</p>
            <p>
              One reviewed PNG package up to 2048 pixels per axis, without
              accepted OCR. TXT/Markdown handoff preparation remains available;
              use the separate four-stage text connection to run text. Prompt
              limit: 64 KiB. Carriage returns/control characters are rejected
              because the CLI can normalize them. The original manual workflows
              keep their existing formats. Explicit preparation writes a local
              handoff folder; there is no automatic cleanup.
            </p>
            <code>{cap.location}</code>
          </details>
          <label className="handoff-label">
            Source type{" "}
            <select
              value={kind}
              disabled={busy}
              onChange={(e) => {
                setKind(e.target.value as "image" | "text");
                setReviewed(null);
                setOutgoingReview(null);
              }}
            >
              <option value="image">Images · built package</option>
              <option value="text">Text · canonical one-shot prompt</option>
            </select>
          </label>
          <p>
            {kind === "image"
              ? built
                ? `${built.itemCount} reviewed image(s) in the current package`
                : "In Images, review one PNG and build its package first."
              : source
                ? source.document.name
                : "Select a TXT or Markdown source in Text."}
          </p>
          {kind === "text" && (
            <p>
              This handoff uses the existing canonical one-shot prompt. Use Run
              four stages below for the demonstrated staged text workflow.
            </p>
          )}
          <label className="local-run-confirm">
            <input
              type="checkbox"
              disabled={!supported || busy}
              checked={Boolean(fingerprint) && reviewed === fingerprint}
              onChange={(e) =>
                setReviewed(e.target.checked ? fingerprint : null)
              }
            />
            I reviewed this source and its settings. Prepare an outgoing
            snapshot.
          </label>
          <button
            className="studio-primary"
            disabled={!supported || reviewed !== fingerprint || busy}
            onClick={() => void prepare()}
          >
            {busy ? "Working…" : "Review handoff"}
          </button>
          {records.length > 0 && (
            <div className="handoff-history">
              <h3>Handoff history</h3>
              {records.map((r) => (
                <button
                  className="studio-secondary"
                  aria-pressed={selected === r.id}
                  key={r.id}
                  onClick={() => {
                    setSelected(r.id);
                    setOutgoingReview(null);
                  }}
                >
                  {r.displayName ?? r.id.slice(0, 8)} · {r.phase}
                </button>
              ))}
            </div>
          )}
          {chosen && (
            <section
              aria-label="Outgoing handoff review"
              className="handoff-outgoing"
            >
              <h3>Outgoing review</h3>
              <p>
                <strong>{chosen.displayName}</strong> · {chosen.workflow}
              </p>
              <p>
                Target: Codex terminal. Status: {chosen.phase}. User acceptance:
                pending.
              </p>
              {chosen.boundaryNote && (
                <p role="status">
                  {chosen.boundaryNote}. No automatic retry or concurrent send.
                </p>
              )}
              {chosen.resendOf && (
                <p role="note">
                  New send linked to <code>{chosen.resendOf}</code>. Confirming
                  it creates a new task and consumes usage; it does not recover
                  or continue the previous task.
                </p>
              )}
              {chosen.events
                ?.filter((e) => e.file === "task-outcome.json")
                .map((e) => (
                  <div key={e.file} className="runs-caption">
                    <p>
                      Executor: {e.actualExecutor ?? "unknown"}. Requested
                      model/effort: {e.requestedModel ?? "unknown"} /{" "}
                      {e.requestedEffort ?? "unknown"}. Actual model/effort:{" "}
                      {e.actualModel ?? "not exposed"} /{" "}
                      {e.actualEffort ?? "not exposed"}.
                    </p>
                    {e.taskId && /^[a-f0-9-]{36}$/.test(e.taskId) && (
                      <p>
                        Task ID: <code>{e.taskId}</code>. Inspect the existing
                        task with <code>codex resume {e.taskId}</code>. No
                        result is accepted automatically.
                      </p>
                    )}
                    <p>
                      The CLI's JSON summary can omit image artifacts. Output
                      review remains in the harness; task completion alone is
                      not proof of generation.
                    </p>
                  </div>
                ))}
              {chosen.error ? (
                <p role="alert">{chosen.error}</p>
              ) : (
                <>
                  <dl>
                    <dt>Prompt SHA-256</dt>
                    <dd>
                      <code>{chosen.promptSha256}</code>
                    </dd>
                    <dt>
                      {chosen.sourceKind === "image"
                        ? "Reference image"
                        : "Reviewed text"}{" "}
                      SHA-256
                    </dt>
                    <dd>
                      <code>{chosen.referenceSha256}</code>
                    </dd>
                  </dl>
                  {chosen.sourceKind === "image" && (
                    <img
                      alt="Exact outgoing reference"
                      src={`/api/handoff/artifact/${chosen.id}/reference.png`}
                      className="handoff-reference"
                    />
                  )}
                  <details>
                    <summary>Read the exact outgoing prompt</summary>
                    <pre className="local-run-text">{chosen.prompt}</pre>
                  </details>
                  {!matches && (
                    <p role="status">
                      The current source differs, or this handoff was reopened
                      without its in-memory association. The saved snapshot
                      remains available; review the current source before
                      preparing a handoff.
                    </p>
                  )}
                  <label className="local-run-confirm">
                    <input
                      type="checkbox"
                      disabled={!matches || busy}
                      checked={outgoingReview === chosen.snapshotSha256}
                      onChange={(e) =>
                        setOutgoingReview(
                          e.target.checked ? chosen.snapshotSha256 : null,
                        )
                      }
                    />
                    I checked the outgoing prompt and attachment. I am ready to
                    choose the explicit terminal action below.
                  </label>
                  <button
                    className="studio-primary"
                    onClick={() => void open()}
                    disabled={
                      !cap.terminalReviewAvailable ||
                      !matches ||
                      outgoingReview !== chosen.snapshotSha256 ||
                      busy ||
                      Boolean(chosen.events?.length)
                    }
                  >
                    Open terminal review
                  </button>
                  {cap.terminalTaskAvailable &&
                    chosen.sourceKind === "image" && (
                      <>
                        <p>
                          Start sends one frozen prompt and PNG to Codex CLI
                          using existing ChatGPT sign-in. Codex may perform
                          multiple internal operations. There is no cost or
                          token cap, automatic retry, or automatic acceptance.
                        </p>
                        <button
                          className="studio-primary"
                          onClick={() => void open(true)}
                          disabled={
                            !matches ||
                            outgoingReview !== chosen.snapshotSha256 ||
                            busy ||
                            Boolean(
                              chosen.events?.some(
                                (e) => e.file === "dispatch-intent.json",
                              ),
                            )
                          }
                        >
                          Start one Codex terminal task
                        </button>
                      </>
                    )}
                  {Boolean(chosen.events?.length) && (
                    <p>
                      This record already has a terminal action. Inspect its
                      retained history. A resend requires a new outgoing review
                      and confirmation; no automatic second launch occurs.
                    </p>
                  )}
                  <div className="local-run-downloads">
                    {chosen.artifacts?.map((name) => (
                      <a
                        key={name}
                        href={`/api/handoff/artifact/${chosen.id}/${name}`}
                        download={name}
                      >
                        {name}
                      </a>
                    ))}
                  </div>
                  <p className="runs-caption">
                    Files persist at <code>{chosen.location}</code>. Downloading
                    is not a handoff or acceptance. Keep exports before
                    explicitly removing only this folder.
                  </p>
                  {chosen.phase !== "prepared" && matches && (
                    <>
                      <p>
                        A resend creates a new linked record for review.
                        Starting it consumes usage as a new task.
                      </p>
                      <button
                        className="studio-secondary"
                        disabled={busy || reviewed !== fingerprint}
                        onClick={() => {
                          requests.current.delete(fingerprint + chosen.id);
                          void prepare(chosen.id);
                        }}
                      >
                        Prepare explicit resend for review
                      </button>
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
