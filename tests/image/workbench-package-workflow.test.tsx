import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_PROMPT_SETTINGS, ownImageBytes, type ImageProvenance } from "../../src/image/contracts";
import type {
  ImagePackageBuildPayload,
  ImagePackageBuildResult,
  ImagePackageManifestV1,
  ImagePackageSnapshot,
} from "../../src/image/export";
import type {
  BrowserImageIntakeServiceOptions,
  ImageAdmission,
  ImageIntakeService,
} from "../../src/image/intake";
import { ImageObjectUrlRegistry } from "../../src/image/objectUrlRegistry";
import { IMAGE_PREFERENCES_STORAGE_KEY } from "../../src/image/preferences";
import { ImageWorkbench } from "../../src/image/workbench/ImageWorkbench";
import type { ImageWorkbenchServices } from "../../src/image/workbench/services";
import { useImageSession, type ImageSessionController } from "../../src/image/workbench/useImageSession";

const HASH = "a".repeat(64);
const ZIP_HASH = "b".repeat(64);
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

function admission(): ImageAdmission {
  const sourceBytes = ownImageBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), "image/png");
  return {
    id: "occurrence-one",
    ordinal: 0,
    sourceBytes,
    byteCount: sourceBytes.size,
    mimeType: "image/png",
    fileExtension: "png",
    sourceHash: HASH,
    width: 3,
    height: 2,
    warnings: ["Exact source bytes may retain EXIF/location metadata."],
    provenance,
  };
}

function artifact(path: string, mediaType: string) {
  return { path, byteCount: 1, sha256: "c".repeat(64), mediaType };
}

function manifest(snapshot: ImagePackageSnapshot): ImagePackageManifestV1 {
  const pair = snapshot.items[0];
  return {
    schemaVersion: 1,
    package: {
      name: "reword-nerd",
      format: "image-reference-prompt-package",
      filename: "reword-nerd-image-prompt-package.zip",
      fixedTimestamp: "1980-01-01T00:00:00.000Z",
      pairCount: 1,
      pairOrder: "confirmed-queue-order",
    },
    privacy: {
      generatedLocally: true,
      automaticUploads: false,
      networkRequests: false,
      sourceBytesMayRetainExifOrLocation: true,
      originalContainersIncluded: false,
    },
    rootArtifacts: {
      readme: artifact("README.md", "text/markdown"),
      openMe: artifact("OPEN-ME.html", "text/html"),
      fullOpenMe: {
        status: "generated",
        path: "OPEN-ME-FULL.html",
        byteCount: 1,
        sha256: "d".repeat(64),
        limitBytes: 33_554_432,
      },
    },
    pairs: [{
      ordinal: 1,
      key: "001-one",
      displayName: pair.provenance.sourceName,
      source: {
        path: "pairs/001-one/source.png",
        mediaType: pair.mimeType,
        extension: pair.fileExtension,
        byteCount: pair.byteCount,
        sha256: pair.sourceHash,
        width: pair.dimensions.width,
        height: pair.dimensions.height,
        provenance: pair.provenance,
      },
      configuration: {
        settings: pair.settings,
        profile: {
          id: "openai-gpt-image",
          label: "OpenAI GPT Image",
          referenceModel: "gpt-image-2 edit",
          profileVersion: pair.expectedProfileVersion,
          lastVerifiedAt: pair.expectedProfileVerifiedAt,
          officialSourceUrls: [],
          capabilityNotes: [],
        },
      },
      ocr: { accepted: false, acceptedTextSha256: null, acceptedCodePoints: null },
      warnings: pair.warnings,
      artifacts: {
        source: artifact("pairs/001-one/source.png", "image/png"),
        prompt: artifact("pairs/001-one/prompt.txt", "text/plain"),
        runCard: artifact("pairs/001-one/run-card.md", "text/markdown"),
        metadata: artifact("pairs/001-one/metadata.json", "application/json"),
        openMe: artifact("pairs/001-one/OPEN-ME.html", "text/html"),
      },
    }],
    artifactInventory: [],
    manifestSelfRecord: { path: "manifest.json", sha256: null, reason: "self-referential-artifact" },
  };
}

function payload(snapshot: ImagePackageSnapshot, overrides: Partial<ImagePackageBuildPayload> = {}): ImagePackageBuildPayload {
  const item = snapshot.items[0];
  const packageBytes = new Blob([new Uint8Array([80, 75, 3, 4])], { type: "application/zip" });
  return {
    packageName: "reword-nerd-image-prompt-package.zip",
    packageBytes,
    packageByteCount: packageBytes.size,
    packageSha256: ZIP_HASH,
    itemCount: 1,
    manifest: manifest(snapshot),
    previewPairs: [{
      occurrenceId: item.occurrenceId,
      sourceHash: item.sourceHash,
      key: "001-one",
      displayName: item.provenance.sourceName,
      sourceFilename: "source.png",
      sourceBytes: item.sourceBytes,
      mimeType: item.mimeType,
      width: item.dimensions.width,
      height: item.dimensions.height,
      provenance: item.provenance,
      profileLabel: "OpenAI GPT Image",
      prompt: "Built exact prompt",
      runCard: "# Built run card",
      warnings: item.warnings,
    }],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function workflowHarness(
  buildImplementation: (snapshot: ImagePackageSnapshot, options?: { signal?: AbortSignal }) => Promise<ImagePackageBuildResult>,
) {
  let intakeOptions!: BrowserImageIntakeServiceOptions;
  const item = admission();
  const intakeService: ImageIntakeService = {
    intake: vi.fn(async () => {
      intakeOptions.publish(item, 0);
      return {
        admissions: [item],
        ledger: [{ inputName: "one.png", path: null, status: "accepted" as const, occurrenceId: item.id, issue: null }],
      };
    }),
    intakeFolder: vi.fn(async () => ({ admissions: [], ledger: [] })),
    reconcile: vi.fn(),
    reset: vi.fn(),
    snapshot: () => ({ count: 0, bytes: 0, sessionEpoch: 0 }),
  };
  const buildPackage = vi.fn(buildImplementation);
  const downloadPackage = vi.fn(() => ({ ok: true as const }));
  const services: ImageWorkbenchServices = {
    createIntake: (options) => { intakeOptions = options; return intakeService; },
    createOcr: () => ({
      recognize: vi.fn(),
      cancelItem: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    }),
    createObjectUrls: () => new ImageObjectUrlRegistry(() => "blob:workflow", () => undefined),
    buildPackage,
    downloadPackage,
    copyPrompt: vi.fn(async () => ({ ok: true as const })),
    copyImage: vi.fn(async () => ({ ok: true as const })),
  };
  return { services, buildPackage, downloadPackage, item };
}

function admitAndConfirm(controller: ImageSessionController): void {
  controller.dispatch({ type: "operation/started", generation: 1, expectedSessionGeneration: 0 });
  controller.dispatch({ type: "items/admitted", generation: 1, expectedSessionGeneration: 0, items: [admission()] });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    IMAGE_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ version: 1, data: { tutorialVersion: "0.8-image-quick-start" } }),
  );
});

describe("Image package controller and build dock", () => {
  it("snapshots before awaiting, permits one active build, and downloads only the current ready output", async () => {
    const pending = deferred<ImagePackageBuildResult>();
    const harness = workflowHarness(() => pending.promise);
    const { result: hook } = renderHook(() => useImageSession(harness.services));
    act(() => admitAndConfirm(hook.current));
    act(() => hook.current.dispatch({ type: "review/confirmed", expectedReviewGeneration: hook.current.state.reviewGeneration }));
    const expectedBuildGeneration = hook.current.state.buildGeneration + 1;

    let first!: Promise<boolean>;
    act(() => { first = hook.current.buildPackage(); });
    expect(harness.buildPackage).toHaveBeenCalledOnce();
    const [captured, options] = harness.buildPackage.mock.calls[0];
    expect(captured).toMatchObject({
      sessionGeneration: 0,
      reviewGeneration: hook.current.state.reviewGeneration,
      confirmedReviewGeneration: hook.current.state.reviewGeneration,
    });
    expect(captured.items[0].settings).toEqual(DEFAULT_IMAGE_PROMPT_SETTINGS);
    expect(options?.signal?.aborted).toBe(false);
    expect(hook.current.state.buildStatus).toBe("building");
    await act(async () => { await expect(hook.current.buildPackage()).resolves.toBe(false); });
    expect(harness.buildPackage).toHaveBeenCalledOnce();
    expect(harness.downloadPackage).not.toHaveBeenCalled();

    await act(async () => { pending.resolve({ ok: true, output: payload(captured) }); await expect(first).resolves.toBe(true); });
    expect(hook.current.state).toMatchObject({ buildStatus: "ready", buildGeneration: expectedBuildGeneration });
    expect(hook.current.state.builtOutput).toMatchObject({
      builtForSessionGeneration: 0,
      builtForReviewGeneration: captured.reviewGeneration,
      buildGeneration: expectedBuildGeneration,
    });
    expect(harness.downloadPackage).not.toHaveBeenCalled();

    const staleDownload = hook.current.downloadPackage;
    act(() => { expect(staleDownload()).toEqual({ ok: true }); });
    expect(harness.downloadPackage).toHaveBeenCalledWith(hook.current.state.builtOutput?.packageBytes);
    const revision = hook.current.state.items[0].reviewRevision;
    act(() => hook.current.dispatch({
      type: "item/setting-changed",
      itemId: hook.current.state.items[0].id,
      expectedReviewRevision: revision,
      field: "requestedChanges",
      value: "A later change",
    }));
    act(() => { expect(staleDownload()).toEqual({ ok: false, message: "The local Image package is not available for download." }); });
    expect(harness.downloadPackage).toHaveBeenCalledOnce();
  });

  it("aborts mutations, suppresses stale overlap, and prevents an older finally from clearing the newer run", async () => {
    const firstPending = deferred<ImagePackageBuildResult>();
    const secondPending = deferred<ImagePackageBuildResult>();
    const harness = workflowHarness(() => harness.buildPackage.mock.calls.length === 1
      ? firstPending.promise
      : secondPending.promise);
    const { result: hook } = renderHook(() => useImageSession(harness.services));
    act(() => admitAndConfirm(hook.current));
    act(() => hook.current.dispatch({ type: "review/confirmed", expectedReviewGeneration: hook.current.state.reviewGeneration }));

    let first!: Promise<boolean>;
    act(() => { first = hook.current.buildPackage(); });
    const firstSnapshot = harness.buildPackage.mock.calls[0][0];
    const firstSignal = harness.buildPackage.mock.calls[0][1]?.signal;
    const revision = hook.current.state.items[0].reviewRevision;
    act(() => hook.current.dispatch({
      type: "item/setting-changed",
      itemId: hook.current.state.items[0].id,
      expectedReviewRevision: revision,
      field: "mustPreserve",
      value: "Keep the center fixed",
    }));
    expect(firstSignal?.aborted).toBe(true);
    expect(firstSnapshot.items[0].settings.mustPreserve).toBe("");

    act(() => hook.current.dispatch({ type: "review/confirmed", expectedReviewGeneration: hook.current.state.reviewGeneration }));
    let second!: Promise<boolean>;
    act(() => { second = hook.current.buildPackage(); });
    expect(harness.buildPackage).toHaveBeenCalledTimes(2);
    const secondSnapshot = harness.buildPackage.mock.calls[1][0];
    expect(secondSnapshot.items[0].settings.mustPreserve).toBe("Keep the center fixed");

    await act(async () => { firstPending.resolve({ ok: true, output: payload(firstSnapshot) }); await expect(first).resolves.toBe(false); });
    expect(hook.current.state.buildStatus).toBe("building");
    await act(async () => { await expect(hook.current.buildPackage()).resolves.toBe(false); });
    expect(harness.buildPackage).toHaveBeenCalledTimes(2);

    await act(async () => { secondPending.resolve({ ok: true, output: payload(secondSnapshot) }); await expect(second).resolves.toBe(true); });
    expect(hook.current.state.buildStatus).toBe("ready");
    expect(hook.current.state.builtOutput?.builtForReviewGeneration).toBe(secondSnapshot.reviewGeneration);
  });

  it("aborts reset and unmount runs and turns safe failures or malformed output into retryable bounded errors", async () => {
    const resetPending = deferred<ImagePackageBuildResult>();
    const resetHarness = workflowHarness(() => resetPending.promise);
    const resetHook = renderHook(() => useImageSession(resetHarness.services));
    act(() => admitAndConfirm(resetHook.result.current));
    act(() => resetHook.result.current.dispatch({ type: "review/confirmed", expectedReviewGeneration: resetHook.result.current.state.reviewGeneration }));
    let resetBuild!: Promise<boolean>;
    act(() => { resetBuild = resetHook.result.current.buildPackage(); });
    const resetSignal = resetHarness.buildPackage.mock.calls[0][1]?.signal;
    act(() => resetHook.result.current.resetSession());
    expect(resetSignal?.aborted).toBe(true);
    await act(async () => {
      resetPending.resolve({ ok: true, output: payload(resetHarness.buildPackage.mock.calls[0][0]) });
      await expect(resetBuild).resolves.toBe(false);
    });
    expect(resetHook.result.current.state).toMatchObject({ items: [], buildStatus: "idle", builtOutput: null });

    const unmountPending = deferred<ImagePackageBuildResult>();
    const unmountHarness = workflowHarness(() => unmountPending.promise);
    const unmountHook = renderHook(() => useImageSession(unmountHarness.services));
    act(() => admitAndConfirm(unmountHook.result.current));
    act(() => unmountHook.result.current.dispatch({ type: "review/confirmed", expectedReviewGeneration: unmountHook.result.current.state.reviewGeneration }));
    let unmountBuild!: Promise<boolean>;
    act(() => { unmountBuild = unmountHook.result.current.buildPackage(); });
    const unmountSignal = unmountHarness.buildPackage.mock.calls[0][1]?.signal;
    unmountHook.unmount();
    expect(unmountSignal?.aborted).toBe(true);
    unmountPending.resolve({ ok: true, output: payload(unmountHarness.buildPackage.mock.calls[0][0]) });
    await expect(unmountBuild).resolves.toBe(false);

    let attempt = 0;
    const failureHarness = workflowHarness(async (snapshot) => {
      attempt += 1;
      if (attempt === 1) return { ok: false, error: { code: "INVALID_SNAPSHOT", message: "The confirmed image set could not be built safely." } };
      return { ok: true, output: payload(snapshot, { packageByteCount: 99 }) };
    });
    const failureHook = renderHook(() => useImageSession(failureHarness.services));
    act(() => admitAndConfirm(failureHook.result.current));
    act(() => failureHook.result.current.dispatch({ type: "review/confirmed", expectedReviewGeneration: failureHook.result.current.state.reviewGeneration }));
    await act(async () => { await expect(failureHook.result.current.buildPackage()).resolves.toBe(false); });
    expect(failureHook.result.current.state).toMatchObject({
      buildStatus: "error",
      safeBuildMessage: "The confirmed image set could not be built safely.",
    });
    await act(async () => { await expect(failureHook.result.current.buildPackage()).resolves.toBe(false); });
    expect(failureHook.result.current.state.buildStatus).toBe("error");
    expect(failureHook.result.current.state.safeBuildMessage).toBe("The local Image package could not be built safely.");
  });

  it("shows exact local-build, failure/retry, success metadata, and deliberate-download dock states", async () => {
    const firstPending = deferred<ImagePackageBuildResult>();
    const secondPending = deferred<ImagePackageBuildResult>();
    let attempt = 0;
    const harness = workflowHarness(() => (++attempt === 1 ? firstPending.promise : secondPending.promise));
    render(<ImageWorkbench services={harness.services} />);
    fireEvent.change(screen.getByLabelText("Add image files"), {
      target: { files: [new File([new Uint8Array([1])], "one.png", { type: "image/png" })] },
    });
    await screen.findByRole("group", { name: "one.png image controls" });
    const settings = screen.getByRole("region", { name: "Image settings" });
    const buildButton = within(settings).getByRole("button", { name: "BUILD PACKAGE" });
    const firstSetting = within(settings).getByLabelText("Default model family");
    expect(buildButton.compareDocumentPosition(firstSetting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(buildButton).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM IMAGE SET" }));
    expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeDisabled();
    expect(screen.getByText(/creates a local ZIP in memory/iu)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
    expect(screen.getByText("Building the local package…")).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeDisabled();
    await act(async () => {
      firstPending.resolve({ ok: false, error: { code: "INVALID_SNAPSHOT", message: "The confirmed image set could not be built safely." } });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("The confirmed image set could not be built safely.");
    expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
    const snapshot = harness.buildPackage.mock.calls[1][0];
    await act(async () => { secondPending.resolve({ ok: true, output: payload(snapshot) }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeEnabled());
    expect(screen.getByText("1 pair")).toBeInTheDocument();
    expect(screen.getByText("4 B ZIP")).toBeInTheDocument();
    expect(screen.getByText(ZIP_HASH)).toBeInTheDocument();
    expect(screen.getByText("Self-contained HTML generated.")).toBeInTheDocument();
    expect(harness.downloadPackage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "DOWNLOAD ZIP" }));
    expect(harness.downloadPackage).toHaveBeenCalledOnce();
    expect(screen.getByText("Download started.")).toHaveAttribute("role", "status");
  });
});
