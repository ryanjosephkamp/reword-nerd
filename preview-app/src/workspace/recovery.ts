import { blobBytes, workspaceHash } from "./codec";
import type { WorkbenchState } from "../app/workbench/contracts";
import type { ImagePortalState } from "../image/reducer";
import { isImagePromptSettings } from "../image/contracts";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid saved workspace state.");
  return value as Record<string, unknown>;
}
const uncertain = new Set(["running", "starting", "dispatching", "pending", "cancelling"]);
function job(value: unknown): unknown {
  if (value === null) return null;
  const record = object(value);
  if (typeof record.id !== "string" && typeof record.jobId !== "string") throw Error("Invalid saved job identity.");
  return { ...record, ...(typeof record.status === "string" && uncertain.has(record.status) ? { status: "unknown-after-recovery" } : {}) };
}

/** Preserve review data; invalidate live operations and all outgoing confirmations. */
export function normalizeRestoredSection(key: string, value: unknown): unknown {
  if (key === "studio") {
    const state = object(value);
    if (!Array.isArray(state.documents) || state.documents.length > 20) throw Error("Invalid saved document inventory.");
    const documents = state.documents.map(raw => {
      const d = object(raw);
      if (typeof d.id !== "string" || typeof d.name !== "string" || typeof d.text !== "string" || typeof d.originalText !== "string" || !(d.original instanceof Blob)) throw Error("Invalid saved document source.");
      return d.status === "loading" ? { ...d, status: "error", error: "Reading was interrupted. The original file and recovered text are preserved; review or reimport it explicitly." } : d;
    });
    return { ...state, documents, building: false };
  }
  if (key === "workbench") {
    const state = object(value) as unknown as WorkbenchState;
    if (!Array.isArray(state.items) || !Array.isArray(state.documents) || !state.intake || !state.export || !state.editor) throw Error("Invalid saved advanced workspace.");
    const items = state.items.map(item => {
      if (item.kind === "project") {
        if (!Array.isArray(item.entries) || typeof item.id !== "string") throw Error("Invalid saved project.");
        const pending = Boolean(state.projectMutationState?.[item.id]);
        return pending ? { ...item, status: "needs-review" as const, requiresReview: true } : item;
      }
      if (!(item.original instanceof Blob) || typeof item.extractedText !== "string" || typeof item.id !== "string") throw Error("Invalid saved advanced source.");
      return ["queued", "extracting"].includes(item.status) ? { ...item, status: "error" as const, requiresReview: true, processingProgress: undefined, safeErrorMessage: "Reading was interrupted. Recovered source bytes and text are retained; reimport explicitly to read again." } : item;
    });
    return { ...state, items, documents: items.filter(item => item.kind !== "project"), intake: { ...state.intake, activeBatchId: null, dragging: false }, activeOverlay: null, focusTarget: null, projectMutationState: {}, export: { ...state.export, status: state.export.builtPackage ? "ready" : "idle", operationId: undefined, operationRevision: undefined } };
  }
  if (key === "images") {
    const state = object(value) as unknown as ImagePortalState;
    if (!Array.isArray(state.items) || state.items.length > 100 || !isImagePromptSettings(state.defaults)) throw Error("Invalid saved image inventory.");
    const items = state.items.map(item => {
      if (typeof item.id !== "string" || !(item.sourceBytes instanceof Blob) || !isImagePromptSettings(item.settings) || !item.ocr) throw Error("Invalid saved image source.");
      return item.ocr.status === "processing" ? { ...item, ocr: { ...item.ocr, status: "failed" as const }, warnings: [...item.warnings, "OCR was interrupted. Run OCR again explicitly if needed."] } : item;
    });
    return { ...state, items, confirmedReviewGeneration: state.buildStatus !== "building" && state.confirmedReviewGeneration === state.reviewGeneration ? state.confirmedReviewGeneration : null, buildStatus: state.builtOutput ? "ready" : "idle" };
  }
  if (key === "collection:records" || key === "handoff:records" || key === "localText:history") {
    if (!Array.isArray(value) || value.length > 256) throw Error("Invalid saved job inventory.");
    return value.map(job);
  }
  if (key === "localText:job" || key === "imagePreparation:job") return job(value);
  return value;
}

/** Recheck semantic source bindings after the container's own integrity check. */
export async function validateWorkspaceBytes(sections: Record<string, unknown>): Promise<void> {
  const seen = new WeakSet<object>();
  async function walk(value: unknown): Promise<void> {
    if (!value || typeof value !== "object" || value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) { for (const [k, v] of value) { await walk(k); await walk(v); } return; }
    if (Array.isArray(value) || value instanceof Set) { for (const v of value) await walk(v); return; }
    const data = value as Record<string, unknown>;
    for (const [bytesKey, hashKey] of [["original", "originalHash"], ["sourceBytes", "sourceHash"], ["originalBytes", "originalHash"], ["bytes", "sha256"], ["packageBytes", "packageSha256"], ["bundle", "bundleHash"]]) {
      const bytes = data[bytesKey], hash = data[hashKey];
      if (typeof hash !== "string" || !(bytes instanceof Blob || bytes instanceof Uint8Array)) continue;
      const actual = await workspaceHash(bytes instanceof Blob ? await blobBytes(bytes) : Uint8Array.from(bytes).buffer);
      if (hash !== actual) throw Error("Recovered source hash binding does not match its retained bytes. The saved copy is unchanged.");
    }
    // A local hash may have been pending at the confirmed save boundary.
    if (Array.isArray(data.documents) && data.editor && typeof data.editor === "object") {
      const editors = data.editor as Record<string, { hashPending?: boolean; hashFailed?: boolean }>;
      for (const raw of data.documents) {
        const d = object(raw), editor = editors[d.id as string];
        if (editor?.hashPending && typeof d.extractedText === "string") {
          d.extractedTextHash = await workspaceHash(new TextEncoder().encode(d.extractedText).buffer);
          d.requiresReview = true; d.status = "needs-review"; editor.hashPending = false; editor.hashFailed = false;
        }
      }
    }
    for (const child of Object.values(data)) await walk(child);
  }
  await walk(sections);
}
