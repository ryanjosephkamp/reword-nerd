import { useReducer } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProject } from "../../src/domain";
import type { ExportSourceInput } from "../../src/export";
import type { WorkbenchServices } from "../../src/app/workbench/contracts";
import { createInitialWorkbenchState, workbenchReducer } from "../../src/app/workbench/reducer";
import { selectFirstExportBlocker } from "../../src/app/workbench/selectors";
import { useExportPackage } from "../../src/app/workbench/useExportPackage";
import { ProjectReview } from "../../src/app/workbench/components/ProjectReview";

const originalHash = "a".repeat(64);
const reviewedHash = "b".repeat(64);

function readyProject(): WorkspaceProject {
  const bytes = new TextEncoder().encode("// reviewed\nexport const value = 1;\n");
  return {
    kind: "project",
    id: "project-alpha",
    name: "alpha",
    sourceKind: "folder",
    status: "ready",
    entries: [{
      path: "src/main.ts",
      immutablePath: "src/main.ts",
      byteCount: bytes.byteLength,
      originalHash,
      sha256: originalHash,
      originalBytes: bytes,
      contentKind: "text",
      languageId: "typescript",
      previewKind: "code",
      reviewedText: "// reviewed\nexport const value = 1;\n",
      reviewedTextHash: reviewedHash,
      reviewRevision: 2,
      promptIncluded: true,
      packageIncluded: true,
      exclusionReason: null,
      restorable: true,
    }],
    originalTreeHash: "c".repeat(64),
    reviewedTreeHash: "d".repeat(64),
    treeHash: "c".repeat(64),
    totalByteCount: bytes.byteLength,
    classification: "general-text",
    classificationChoiceRequired: false,
    classificationChoices: ["general-text", "latex"],
    rootDocument: null,
    selectedEntryPath: "src/main.ts",
    projectOperationGeneration: 0,
    projectReviewRevision: 2,
    requiresReview: false,
    warnings: [],
    sensitiveBlockedCounts: { credentialFiles: 0, privateKeys: 0, clearCredentials: 0 },
    intake: { kind: "folder", displayName: "alpha" },
    settingsOverride: {},
    contextWarningAcknowledged: false,
  };
}

function readyState() {
  return workbenchReducer(createInitialWorkbenchState(), {
    type: "project/admitted",
    project: readyProject(),
    uploadOrdinal: 0,
  });
}

function Harness({ services }: { services: WorkbenchServices }) {
  const [state, dispatch] = useReducer(workbenchReducer, undefined, readyState);
  const exporter = useExportPackage(state, dispatch, services);
  return <button type="button" onClick={() => void exporter.build()}>Build project</button>;
}

describe("project export plumbing", () => {
  it("maps the canonical workspace project into one project-aware package input", async () => {
    // This catches the v0.5 documents compatibility alias silently dropping every project at BUILD.
    const buildPackage = vi.fn<WorkbenchServices["buildPackage"]>().mockResolvedValue({
      ok: false,
      error: { code: "ARCHIVE_GENERATION_FAILED", message: "fixture stops after capture" },
    });
    const services: WorkbenchServices = {
      createDocumentId: () => "unused",
      preflight: async () => [],
      extract: async () => { throw new Error("unused"); },
      hashText: async () => "unused",
      buildPackage,
      download: () => ({ ok: true }),
      downloadProgressCopy: () => ({ ok: true }),
    };
    render(<Harness services={services} />);

    fireEvent.click(screen.getByRole("button", { name: "Build project" }));

    await waitFor(() => expect(buildPackage).toHaveBeenCalledTimes(1));
    const inputs = buildPackage.mock.calls[0][0] as readonly ExportSourceInput[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      kind: "project",
      projectId: "project-alpha",
      projectName: "alpha",
      project: { reviewedTreeHash: "d".repeat(64), projectReviewRevision: 2 },
    });
    expect(inputs[0].promptBundle.oneShot).toContain("BEGIN PROJECT");
    expect(inputs[0].promptBundle.oneShot).toContain("src/main.ts");
  });

  it("invalidates and blocks export synchronously while a project mutation awaits hashing", () => {
    // This catches a BUILD click during the 120 ms editor debounce exporting the previous reviewed text.
    const before = readyState();
    const pending = workbenchReducer(before, {
      type: "project/mutation-started",
      itemId: "project-alpha",
      originalTreeHash: before.items[0].kind === "project" ? before.items[0].originalTreeHash : "",
      projectOperationGeneration: 0,
      ticket: 1,
    });
    const duplicate = workbenchReducer(pending, {
      type: "project/mutation-started",
      itemId: "project-alpha",
      originalTreeHash: "c".repeat(64),
      projectOperationGeneration: 0,
      ticket: 1,
    });

    expect(pending.revision).toBe(before.revision + 1);
    expect(duplicate).toBe(pending);
    expect(pending.projectMutationState["project-alpha"]).toMatchObject({ latestTicket: 1, status: "pending" });
    expect(selectFirstExportBlocker(pending)).toBe("A project review change is still being applied.");
    const failed = workbenchReducer(pending, {
      type: "project/mutation-failed",
      itemId: "project-alpha",
      originalTreeHash: "c".repeat(64),
      projectOperationGeneration: 0,
      ticket: 1,
    });
    expect(failed.projectMutationState["project-alpha"]?.status).toBe("failed");
    expect(selectFirstExportBlocker(failed)).toBe("Retry the failed project review change before export.");
  });

  it("raises the pending guard on the first project-editor input and clears it only after acceptance", async () => {
    // This catches the UI waiting for its debounce timer before protecting BUILD from an obsolete reviewed snapshot.
    let ticket = 0;
    const intent = vi.fn(() => ++ticket);
    const edit = vi.fn(async () => undefined);
    render(<ProjectReview
      project={readyProject()}
      onSelect={() => undefined}
      onMutationIntent={intent}
      onEdit={edit}
      onInclusion={() => undefined}
      onClassification={() => undefined}
      onConfirm={() => undefined}
    />);
    const editor = screen.getByRole("textbox", { name: "Reviewed text for src/main.ts" });

    fireEvent.change(editor, { target: { value: "// changed immediately\nexport const value = 1;\n" } });
    expect(intent).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();

    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    // A real reducer acceptance supplies a new entry hash/text; model that rerender boundary.
    expect(edit).toHaveBeenCalledWith("src/main.ts", "// changed immediately\nexport const value = 1;\n", 1);
  });

  it("does not clear a project-wide pending edit when the user switches to another entry", async () => {
    // This catches entry B mounting and unlocking BUILD while entry A's debounced review operation is unresolved.
    const bytes = new TextEncoder().encode("second\n");
    const project = {
      ...readyProject(),
      entries: [...readyProject().entries, {
        ...readyProject().entries[0],
        path: "src/second.ts",
        immutablePath: "src/second.ts",
        originalBytes: bytes,
        byteCount: bytes.byteLength,
        reviewedText: "second\n",
      }],
    };
    let ticket = 0;
    const intent = vi.fn(() => ++ticket);
    const edit = vi.fn(async () => undefined);
    const view = render(<ProjectReview
      project={project}
      onSelect={() => undefined}
      onMutationIntent={intent}
      onEdit={edit}
      onInclusion={() => undefined}
      onClassification={() => undefined}
      onConfirm={() => undefined}
    />);
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewed text for src/main.ts" }), { target: { value: "changed A\n" } });
    expect(intent).toHaveBeenCalledTimes(1);

    view.rerender(<ProjectReview
      project={{ ...project, selectedEntryPath: "src/second.ts" }}
      onSelect={() => undefined}
      onMutationIntent={intent}
      onEdit={edit}
      onInclusion={() => undefined}
      onClassification={() => undefined}
      onConfirm={() => undefined}
    />);

    expect(screen.getByRole("textbox", { name: "Reviewed text for src/second.ts" })).toBeInTheDocument();
    expect(edit).toHaveBeenCalledWith("src/main.ts", "changed A\n", 1);
  });

  it("keeps BUILD blocked across a deferred edit hash and file switch until the exact edit is accepted", async () => {
    // This catches a file-selection render clearing the guard before the async reviewed-tree hash completes.
    const { editProjectEntryText } = await import("../../src/domain");
    const bytes = new TextEncoder().encode("second\n");
    const project = {
      ...readyProject(),
      entries: [...readyProject().entries, {
        ...readyProject().entries[0],
        path: "src/second.ts",
        immutablePath: "src/second.ts",
        originalBytes: bytes,
        byteCount: bytes.byteLength,
        reviewedText: "second\n",
      }],
    };
    const admitted = workbenchReducer(createInitialWorkbenchState(), { type: "project/admitted", project, uploadOrdinal: 0 });
    const guarded = workbenchReducer(admitted, {
      type: "project/mutation-started",
      itemId: project.id,
      originalTreeHash: project.originalTreeHash,
      projectOperationGeneration: project.projectOperationGeneration,
      ticket: 1,
    });
    let release!: () => void;
    let first = true;
    const operation = editProjectEntryText(project, "src/main.ts", "changed A\n", {
      digest: async (buffer) => {
        if (first) {
          first = false;
          await new Promise<void>((resolve) => { release = resolve; });
        }
        return crypto.subtle.digest("SHA-256", buffer);
      },
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const switched = workbenchReducer(guarded, { type: "project/selected-entry", itemId: project.id, path: "src/second.ts" });
    expect(selectFirstExportBlocker(switched)).toBe("A project review change is still being applied.");
    release();
    const updated = await operation;
    const accepted = workbenchReducer(switched, {
      type: "project/review-updated",
      itemId: project.id,
      expectedOriginalTreeHash: project.originalTreeHash,
      expectedReviewRevision: project.projectReviewRevision,
      expectedOperationGeneration: project.projectOperationGeneration,
      project: updated,
      mutationTicket: 1,
    });
    expect(accepted.projectMutationState[project.id]).toBeUndefined();
    expect(selectFirstExportBlocker(accepted)).toBe("Review and confirm every project before export");
  });

  it("ignores a stale pending completion after a same-id project is removed and reimported", () => {
    // This catches an old editor debounce unlocking BUILD for a newer project generation with the same content-derived ID.
    const first = readyState();
    const firstProject = first.items[0];
    if (firstProject.kind !== "project") throw new Error("project fixture required");
    const pending = workbenchReducer(first, {
      type: "project/mutation-started",
      itemId: firstProject.id,
      originalTreeHash: firstProject.originalTreeHash,
      projectOperationGeneration: firstProject.projectOperationGeneration,
      ticket: 1,
    });
    const removed = workbenchReducer(pending, { type: "item/removed", itemId: firstProject.id });
    const reimport = { ...readyProject(), projectOperationGeneration: 1 };
    const second = workbenchReducer(removed, { type: "project/admitted", project: reimport, uploadOrdinal: 1 });
    const secondPending = workbenchReducer(second, {
      type: "project/mutation-started",
      itemId: reimport.id,
      originalTreeHash: reimport.originalTreeHash,
      projectOperationGeneration: reimport.projectOperationGeneration,
      ticket: 2,
    });
    const staleCompletion = workbenchReducer(secondPending, {
      type: "project/mutation-failed",
      itemId: firstProject.id,
      originalTreeHash: firstProject.originalTreeHash,
      projectOperationGeneration: firstProject.projectOperationGeneration,
      ticket: 1,
    });

    expect(staleCompletion).toBe(secondPending);
    expect(selectFirstExportBlocker(staleCompletion)).toBe("A project review change is still being applied.");
  });

  it("keeps BUILD blocked until the newest of two same-file edits is accepted", () => {
    const initial = readyState();
    const first = workbenchReducer(initial, { type: "project/mutation-started", itemId: "project-alpha", originalTreeHash: "c".repeat(64), projectOperationGeneration: 0, ticket: 1 });
    const second = workbenchReducer(first, { type: "project/mutation-started", itemId: "project-alpha", originalTreeHash: "c".repeat(64), projectOperationGeneration: 0, ticket: 2 });
    const projectA = { ...readyProject(), projectReviewRevision: 3 };
    const acceptedA = workbenchReducer(second, {
      type: "project/review-updated", itemId: "project-alpha", expectedOriginalTreeHash: "c".repeat(64),
      expectedReviewRevision: 2, expectedOperationGeneration: 0, mutationTicket: 1, project: projectA,
    });
    expect(acceptedA.projectMutationState["project-alpha"]).toMatchObject({ latestTicket: 2, status: "pending" });
    expect(selectFirstExportBlocker(acceptedA)).toBe("A project review change is still being applied.");
    const projectB = { ...projectA, projectReviewRevision: 4 };
    const acceptedB = workbenchReducer(acceptedA, {
      type: "project/review-updated", itemId: "project-alpha", expectedOriginalTreeHash: "c".repeat(64),
      expectedReviewRevision: 3, expectedOperationGeneration: 0, mutationTicket: 2, project: projectB,
    });
    expect(acceptedB.projectMutationState["project-alpha"]).toBeUndefined();
  });

  it("keeps a rejected latest mutation blocked and allows the same ticket to succeed on retry", () => {
    const initial = readyState();
    const pending = workbenchReducer(initial, { type: "project/mutation-started", itemId: "project-alpha", originalTreeHash: "c".repeat(64), projectOperationGeneration: 0, ticket: 7 });
    const failed = workbenchReducer(pending, { type: "project/mutation-failed", itemId: "project-alpha", originalTreeHash: "c".repeat(64), projectOperationGeneration: 0, ticket: 7 });
    expect(selectFirstExportBlocker(failed)).toBe("Retry the failed project review change before export.");
    const retrying = workbenchReducer(failed, { type: "project/mutation-started", itemId: "project-alpha", originalTreeHash: "c".repeat(64), projectOperationGeneration: 0, ticket: 7 });
    expect(retrying.projectMutationState["project-alpha"]?.status).toBe("pending");
    const accepted = workbenchReducer(retrying, {
      type: "project/review-updated", itemId: "project-alpha", expectedOriginalTreeHash: "c".repeat(64),
      expectedReviewRevision: 2, expectedOperationGeneration: 0, mutationTicket: 7,
      project: { ...readyProject(), projectReviewRevision: 3 },
    });
    expect(accepted.projectMutationState["project-alpha"]).toBeUndefined();
  });

  it("stores context-warning acknowledgment on the selected project", () => {
    const state = readyState();
    const acknowledged = workbenchReducer(state, {
      type: "context/acknowledged",
      itemId: "project-alpha",
      acknowledged: true,
    });
    expect(acknowledged.items[0]).toMatchObject({ kind: "project", contextWarningAcknowledged: true });
  });

  it("allocates synchronous mutation tickets for inclusion and classification intents", () => {
    let ticket = 10;
    const intent = vi.fn(() => ++ticket);
    const inclusion = vi.fn();
    const classification = vi.fn();
    const view = render(<ProjectReview
      project={readyProject()}
      onSelect={() => undefined}
      onMutationIntent={intent}
      onEdit={() => undefined}
      onInclusion={inclusion}
      onClassification={classification}
      onConfirm={() => undefined}
    />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include in package" }));
    expect(inclusion).toHaveBeenCalledWith("src/main.ts", false, false, 11);

    view.rerender(<ProjectReview
      project={{ ...readyProject(), classificationChoiceRequired: true }}
      onSelect={() => undefined}
      onMutationIntent={intent}
      onEdit={() => undefined}
      onInclusion={inclusion}
      onClassification={classification}
      onConfirm={() => undefined}
    />);
    fireEvent.change(screen.getByRole("combobox", { name: "Project classification" }), { target: { value: "general-text" } });
    expect(classification).toHaveBeenCalledWith("general-text", null, 12);
    expect(intent).toHaveBeenCalledTimes(2);
  });
});
