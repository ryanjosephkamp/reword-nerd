import { createInitialWorkbenchState, workbenchReducer } from "../../src/app/workbench/reducer";
import type { WorkspaceProject } from "../../src/domain";

function project(revision = 0): WorkspaceProject {
  const bytes = new TextEncoder().encode("hello");
  return {
    kind: "project",
    id: "project-1",
    name: "sample-project",
    sourceKind: "folder",
    status: "needs-review",
    entries: [{
      path: "src/readme.md", immutablePath: "src/readme.md", byteCount: bytes.byteLength,
      originalHash: "original-file", sha256: "original-file", originalBytes: bytes,
      contentKind: "text", languageId: "markdown", previewKind: "markdown", reviewedText: "hello",
      reviewedTextHash: `reviewed-${revision}`, reviewRevision: revision, promptIncluded: true,
      packageIncluded: true, exclusionReason: null, restorable: true,
    }],
    originalTreeHash: "original-tree", reviewedTreeHash: `reviewed-tree-${revision}`, treeHash: "original-tree",
    totalByteCount: bytes.byteLength, classification: "general-text", classificationChoiceRequired: false,
    classificationChoices: ["general-text", "latex"], rootDocument: null, selectedEntryPath: "src/readme.md",
    projectOperationGeneration: 2, projectReviewRevision: revision, requiresReview: true, warnings: [],
    sensitiveBlockedCounts: { credentialFiles: 0, privateKeys: 0, clearCredentials: 0 },
    intake: { kind: "folder", displayName: "sample-project" }, settingsOverride: {},
    contextWarningAcknowledged: false,
  };
}

describe("project workbench state", () => {
  it("admits WorkspaceItem projects and rejects a stale review completion", () => {
    // This catches document-only state and late project hashes overwriting a newer review revision.
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, { type: "project/admitted", project: project(), uploadOrdinal: 0 } as never);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: "project", id: "project-1" });
    expect(state.selectedItemId).toBe("project-1");

    state = workbenchReducer(state, {
      type: "project/review-updated", itemId: "project-1", expectedOriginalTreeHash: "original-tree",
      expectedReviewRevision: 0, expectedOperationGeneration: 2, project: project(1),
    } as never);
    expect((state.items[0] as WorkspaceProject).projectReviewRevision).toBe(1);

    const current = state;
    state = workbenchReducer(state, {
      type: "project/review-updated", itemId: "project-1", expectedOriginalTreeHash: "original-tree",
      expectedReviewRevision: 0, expectedOperationGeneration: 2, project: project(99),
    } as never);
    expect(state).toBe(current);

    state = workbenchReducer(state, {
      type: "project/review-updated", itemId: "project-1", expectedOriginalTreeHash: "original-tree",
      expectedReviewRevision: 1, expectedOperationGeneration: 1, project: project(2),
    } as never);
    expect(state).toBe(current);
  });

  it("rejects duplicate project tree hashes or IDs without aliasing selection and mutation custody", () => {
    // This is reducer defense-in-depth for deterministic IDs and guards every ID-keyed update path from duplicate rows.
    let state = workbenchReducer(createInitialWorkbenchState(), {
      type: "project/admitted", project: project(), uploadOrdinal: 0,
    } as never);
    state = workbenchReducer(state, {
      type: "project/mutation-started", itemId: "project-1", originalTreeHash: "original-tree",
      projectOperationGeneration: 2, ticket: 7,
    } as never);
    const pending = state;

    state = workbenchReducer(state, {
      type: "project/admitted",
      project: { ...project(), id: "project-copy", name: "copy" },
      uploadOrdinal: 1,
    } as never);
    expect(state).toBe(pending);
    expect(state.items).toHaveLength(1);
    expect(state.selectedItemId).toBe("project-1");
    expect((state.items[0] as WorkspaceProject).originalTreeHash).toBe("original-tree");
    expect(state.projectMutationState["project-1"]).toMatchObject({ latestTicket: 7, status: "pending" });

    state = workbenchReducer(state, {
      type: "project/admitted",
      project: { ...project(), originalTreeHash: "different-original-tree" },
      uploadOrdinal: 2,
    } as never);
    expect(state).toBe(pending);

    const stale = workbenchReducer(state, {
      type: "project/review-updated", itemId: "project-1", expectedOriginalTreeHash: "different-original-tree",
      expectedReviewRevision: 0, expectedOperationGeneration: 2, project: { ...project(1), originalTreeHash: "different-original-tree" },
    } as never);
    expect(stale).toBe(pending);
  });

  it("ignores a late project edit after removal or a confirmed new session", () => {
    // This proves completed hashes cannot resurrect a project after destructive workspace boundaries.
    let state = workbenchReducer(createInitialWorkbenchState(), { type: "project/admitted", project: project(), uploadOrdinal: 0 } as never);
    const late = { type: "project/review-updated", itemId: "project-1", expectedOriginalTreeHash: "original-tree", expectedReviewRevision: 0, expectedOperationGeneration: 2, project: project(1) } as const;
    state = workbenchReducer(state, { type: "item/removed", itemId: "project-1" } as never);
    expect(workbenchReducer(state, late as never).items).toHaveLength(0);

    state = workbenchReducer(createInitialWorkbenchState(), { type: "project/admitted", project: project(), uploadOrdinal: 0 } as never);
    state = workbenchReducer(state, { type: "session/reset-confirmed" } as never);
    expect(workbenchReducer(state, late as never).items).toHaveLength(0);
  });

  it("keeps a project selected when switching from a standalone document", () => {
    // This catches the legacy selectedDocumentId alias clearing canonical project selection.
    let state = workbenchReducer(createInitialWorkbenchState(), { type: "project/admitted", project: project(), uploadOrdinal: 0 } as never);
    const original = new File(["text"], "note.md");
    state = workbenchReducer(state, { type: "intake/accepted", batchId: "batch", documents: [{ uploadOrdinal: 1, document: {
      kind: "document", id: "document-1", original, originalByteSize: original.size, originalHash: "", name: original.name,
      format: "markdown", status: "queued", extractedText: "", extractedTextHash: "", warnings: [], requiresReview: true,
      settingsOverride: {}, contextWarningAcknowledged: false,
    } }] } as never);
    expect(state.selectedItemId).toBe("document-1");
    state = workbenchReducer(state, { type: "item/selection-changed", itemId: "project-1" });
    expect(state.selectedItemId).toBe("project-1");
    expect(state.selectedDocumentId).toBeNull();
  });

  it.each([
    ["model profile", { type: "profile/selected", profileId: "anthropic-general" }],
    ["context limit", { type: "profile/context-limit-changed", value: 4_000 }],
    ["custom context draft", { type: "profile/custom-context-draft-changed", value: "8000", parsed: 8_000 }],
  ] as const)("clears project context acknowledgment after a %s change", (_label, action) => {
    // This catches project acknowledgments remaining valid after the model context basis changes.
    let state = workbenchReducer(createInitialWorkbenchState(), {
      type: "project/admitted",
      project: { ...project(), contextWarningAcknowledged: true },
      uploadOrdinal: 0,
    } as never);

    state = workbenchReducer(state, action);

    expect(state.items[0]).toMatchObject({ kind: "project", contextWarningAcknowledged: false });
  });
});
