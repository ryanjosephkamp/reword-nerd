// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createInitialWorkbenchState } from "../../src/app/workbench/reducer";
import { createInitialImagePortalState } from "../../src/image/reducer";
import { normalizeRestoredSection, validateWorkspaceBytes } from "../../src/workspace/recovery";
import { workspaceHash } from "../../src/workspace/codec";

describe("inert workspace recovery", () => {
  it("preserves original and reviewed Studio text while stopping interrupted extraction", () => {
    const original = new File(["original\r\n"], "source.md");
    const studio = { documents: [{ id: "one", name: "source.md", text: "reviewed\r\n", originalText: "original\r\n", original, status: "loading" }], selectedId: "one", settings: {}, building: true };
    const restored = normalizeRestoredSection("studio", studio) as typeof studio;
    expect(restored.documents[0].original).toBe(original);
    expect(restored.documents[0].text).toBe("reviewed\r\n");
    expect(restored.documents[0].status).toBe("error");
    expect(restored.building).toBe(false);
    expect(studio.documents[0].status).toBe("loading");
  });

  it("resets transient workbench operations and outgoing image confirmation", () => {
    const wb = createInitialWorkbenchState(null); wb.activeOverlay = "new-session"; wb.intake.activeBatchId = "active"; wb.export.status = "building"; wb.focusTarget = "upload";
    const restored = normalizeRestoredSection("workbench", wb) as typeof wb;
    expect(restored.activeOverlay).toBeNull();
    expect(restored.intake.activeBatchId).toBeNull();
    expect(restored.export.status).toBe("idle");
    expect(restored.focusTarget).toBeNull();
    const images = { ...createInitialImagePortalState(), confirmedReviewGeneration: 3, buildStatus: "building" as const };
    const result = normalizeRestoredSection("images", images) as typeof images;
    expect(result.confirmedReviewGeneration).toBeNull();
    expect(result.buildStatus).toBe("idle");
  });

  it("preserves a running job identity and marks its restored reference uncertain", () => {
    const records = [{ id: "owned-1", taskId: "task-1", status: "running", runtime: { model: "ExactModel", effort: "medium" } }];
    const restored = normalizeRestoredSection("collection:records", records) as typeof records;
    expect(restored[0]).toMatchObject({ id: "owned-1", taskId: "task-1", status: "unknown-after-recovery" });
    expect(restored[0].runtime).toEqual(records[0].runtime);
  });

  it("rejects source identity mismatches even when a container is otherwise well formed", async () => {
    const sourceBytes = new Blob(["original"]);
    const originalHash = await workspaceHash(await sourceBytes.arrayBuffer());
    await expect(validateWorkspaceBytes({ images: { sourceBytes, sourceHash: originalHash } })).resolves.toBeUndefined();
    await expect(validateWorkspaceBytes({ images: { sourceBytes, sourceHash: "0".repeat(64) } })).rejects.toThrow(/source|binding|hash/i);
  });
});
