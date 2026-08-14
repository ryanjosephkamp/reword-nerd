import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ownImageBytes, type ImageProvenance } from "../../src/image/contracts";
import type {
  BrowserImageIntakeServiceOptions,
  ImageAdmission,
  ImageInputFile,
  ImageIntakeResult,
  ImageIntakeService,
} from "../../src/image/intake";
import { ImageObjectUrlRegistry } from "../../src/image/objectUrlRegistry";
import type { ImageWorkbenchServices } from "../../src/image/workbench/services";
import { useImageSession } from "../../src/image/workbench/useImageSession";

const HASH = "a".repeat(64);
const provenance: ImageProvenance = {
  intakeKind: "direct",
  sourceName: "one.png",
  sourcePath: null,
  containerChain: [],
  containerName: null,
  containerHash: null,
  containerPath: null,
  pageNumber: null,
  relationshipId: null,
};

function admission(id = "occ-1"): ImageAdmission {
  const sourceBytes = ownImageBytes(new Uint8Array([1, 2, 3]), "image/png");
  return {
    id,
    ordinal: 0,
    sourceBytes,
    byteCount: 3,
    mimeType: "image/png",
    fileExtension: "png",
    sourceHash: HASH,
    width: 3,
    height: 2,
    warnings: [],
    provenance,
  };
}

function input(name = "one.png"): ImageInputFile {
  return { name, type: "image/png", size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
}

function result(value: ImageAdmission, status: "accepted" | "rejected" = "accepted"): ImageIntakeResult {
  return {
    admissions: status === "accepted" ? [value] : [],
    ledger: [{
      inputName: value.provenance.sourceName,
      path: null,
      status,
      occurrenceId: status === "accepted" ? value.id : null,
      issue: status === "accepted" ? null : { code: "UNSUPPORTED_FORMAT", message: "Unsupported", path: null },
    }],
  };
}

function serviceHarness(run?: (
  options: BrowserImageIntakeServiceOptions,
  route: "files" | "folder",
) => Promise<ImageIntakeResult>) {
  let options!: BrowserImageIntakeServiceOptions;
  const reconcile = vi.fn();
  const reset = vi.fn();
  const intake = vi.fn(() => run!(options, "files"));
  const intakeFolder = vi.fn(() => run!(options, "folder"));
  const service: ImageIntakeService = {
    intake,
    intakeFolder,
    reconcile,
    reset,
    snapshot: () => ({ count: 0, bytes: 0, sessionEpoch: 0 }),
  };
  const services: ImageWorkbenchServices = {
    createIntake: (value) => { options = value; return service; },
    createOcr: () => ({
      recognize: vi.fn(),
      cancelItem: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    }),
    createObjectUrls: () => new ImageObjectUrlRegistry(() => "blob:test", () => undefined),
  };
  return { services, service, reconcile, reset, intake, intakeFolder, options: () => options };
}

describe("useImageSession publication custody", () => {
  it("acknowledges one synchronous publication, reconciles predicted state, and never redispatches result admissions", async () => {
    let acknowledgement: unknown;
    const item = admission();
    const harness = serviceHarness(async (options) => {
      acknowledgement = options.publish(item, 0);
      return result(item);
    });
    const { result: hook } = renderHook(() => useImageSession(harness.services));

    await act(async () => { await hook.current.intakeFiles([input()]); });

    expect(acknowledgement).toEqual({ accepted: true, occurrenceId: "occ-1", sessionEpoch: 0 });
    expect(hook.current.state.items).toHaveLength(1);
    expect(hook.current.state.items[0].sourceBytes).toBe(item.sourceBytes);
    expect(harness.reconcile).toHaveBeenCalledWith([
      expect.objectContaining({ id: "occ-1", sourceBytes: item.sourceBytes }),
    ]);
    expect(hook.current.ledger).toEqual(result(item).ledger);
  });

  it("allows only one UI intake, routes folders explicitly, and suppresses stale completion after reset", async () => {
    let finish!: (value: ImageIntakeResult) => void;
    let route: string | null = null;
    const pending = new Promise<ImageIntakeResult>((resolve) => { finish = resolve; });
    const harness = serviceHarness(async (_options, nextRoute) => { route = nextRoute; return pending; });
    const { result: hook } = renderHook(() => useImageSession(harness.services));

    let first!: Promise<boolean>;
    act(() => { first = hook.current.intakeFolder([input("folder.png")]); });
    expect(hook.current.intakeBusy).toBe(true);
    await act(async () => { await expect(hook.current.intakeFiles([input("second.png")])).resolves.toBe(false); });
    expect(harness.intake).not.toHaveBeenCalled();
    expect(harness.intakeFolder).toHaveBeenCalledOnce();
    expect(route).toBe("folder");

    act(() => hook.current.resetSession());
    expect(harness.reset).toHaveBeenCalledOnce();
    await act(async () => { finish(result(admission("old"))); await first; });
    expect(hook.current.state.items).toEqual([]);
    expect(hook.current.ledger).toEqual([]);
    expect(hook.current.intakeBusy).toBe(false);
  });

  it("closes and rejects an active PDF request when its intake signal aborts", async () => {
    const harness = serviceHarness(async () => result(admission()));
    const { result: hook } = renderHook(() => useImageSession(harness.services));
    const controller = new AbortController();
    let pending!: Promise<unknown>;

    act(() => {
      pending = Promise.resolve(harness.options().resolvePdfCapture?.({
        inputName: "pages.pdf",
        path: "nested/pages.pdf",
        pageCount: 2,
        signal: controller.signal,
      }));
    });
    expect(hook.current.pdfCapture).toEqual({ inputName: "pages.pdf", path: "nested/pages.pdf", pageCount: 2 });
    await act(async () => {
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(hook.current.pdfCapture).toBeNull();
  });
});
