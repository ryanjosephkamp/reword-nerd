import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownImageBytes, type ImageProvenance } from "../../src/image/contracts";
import type {
  ImageBuiltPairPreview,
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
import { ImagePackagePreview } from "../../src/image/workbench/ImagePackagePreview";
import type { ImageWorkbenchServices } from "../../src/image/workbench/services";

const provenance: ImageProvenance = {
  intakeKind: "folder",
  sourceName: "built-source.png",
  sourcePath: "album/built-source.png",
  containerChain: [{ kind: "folder", name: "album", sha256: null, path: null, byteCount: null }],
  containerName: "album",
  containerHash: null,
  containerPath: null,
  pageNumber: null,
  relationshipId: null,
};

function previewPair(index = 1, overrides: Partial<ImageBuiltPairPreview> = {}): ImageBuiltPairPreview {
  const sourceBytes = ownImageBytes(new Uint8Array([137, 80, 78, 71, index]), "image/png");
  return {
    occurrenceId: `built-${index}`,
    sourceHash: `${String(index).padStart(2, "0")}${"a".repeat(62)}`,
    key: `${String(index).padStart(3, "0")}-built-source`,
    displayName: `built-source-${index}.png`,
    sourceFilename: "source.png",
    sourceBytes,
    mimeType: "image/png",
    width: 20,
    height: 10,
    provenance: { ...provenance, sourceName: `built-source-${index}.png`, sourcePath: `album/built-source-${index}.png` },
    profileLabel: "OpenAI GPT Image",
    prompt: `BUILT EXACT PROMPT ${index}`,
    runCard: `# BUILT RUN CARD ${index}`,
    warnings: [`Built warning ${index}`],
    ...overrides,
  };
}

function registryHarness() {
  const created: string[] = [];
  const revoked: string[] = [];
  let sequence = 0;
  return {
    created,
    revoked,
    registry: new ImageObjectUrlRegistry(
      () => {
        const url = `blob:package-preview-${++sequence}`;
        created.push(url);
        return url;
      },
      (url) => revoked.push(url),
    ),
  };
}

function admission(): ImageAdmission {
  const pair = previewPair();
  return {
    id: pair.occurrenceId,
    ordinal: 0,
    sourceBytes: pair.sourceBytes,
    byteCount: pair.sourceBytes.size,
    mimeType: pair.mimeType,
    fileExtension: "png",
    sourceHash: pair.sourceHash,
    width: pair.width,
    height: pair.height,
    warnings: pair.warnings,
    provenance: pair.provenance,
  };
}

function buildResult(snapshot: ImagePackageSnapshot): ImagePackageBuildResult {
  const packageBytes = new Blob([new Uint8Array([80, 75, 3, 4])], { type: "application/zip" });
  const manifest = {
    schemaVersion: 1,
    package: {
      name: "reword-nerd",
      format: "image-reference-prompt-package",
      filename: "reword-nerd-image-prompt-package.zip",
      fixedTimestamp: "1980-01-01T00:00:00.000Z",
      pairCount: 1,
      pairOrder: "confirmed-queue-order",
    },
    rootArtifacts: {
      fullOpenMe: { status: "omitted", path: null, byteCount: null, sha256: null, limitBytes: 33_554_432, reason: "encoded-size-limit" },
    },
    pairs: [{}],
  } as unknown as ImagePackageManifestV1;
  return {
    ok: true,
    output: {
      packageName: "reword-nerd-image-prompt-package.zip",
      packageBytes,
      packageByteCount: packageBytes.size,
      packageSha256: "f".repeat(64),
      itemCount: 1,
      manifest,
      previewPairs: [previewPair(1, {
        occurrenceId: snapshot.items[0].occurrenceId,
        sourceHash: snapshot.items[0].sourceHash,
        sourceBytes: snapshot.items[0].sourceBytes,
      })],
    },
  };
}

function workbenchHarness() {
  const objectUrls = registryHarness();
  const item = admission();
  let intakeOptions!: BrowserImageIntakeServiceOptions;
  const intake: ImageIntakeService = {
    intake: vi.fn(async () => {
      intakeOptions.publish(item, 0);
      return {
        admissions: [item],
        ledger: [{ inputName: item.provenance.sourceName, path: item.provenance.sourcePath, status: "accepted" as const, occurrenceId: item.id, issue: null }],
      };
    }),
    intakeFolder: vi.fn(async () => ({ admissions: [], ledger: [] })),
    reconcile: vi.fn(),
    reset: vi.fn(),
    snapshot: () => ({ count: 0, bytes: 0, sessionEpoch: 0 }),
  };
  const services: ImageWorkbenchServices = {
    createIntake: (options) => { intakeOptions = options; return intake; },
    createOcr: () => ({ recognize: vi.fn(), cancelItem: vi.fn(), reset: vi.fn(), dispose: vi.fn() }),
    createObjectUrls: () => objectUrls.registry,
    buildPackage: vi.fn(async (snapshot) => buildResult(snapshot)),
    downloadPackage: vi.fn(() => ({ ok: true } as const)),
    copyPrompt: vi.fn(async () => ({ ok: true } as const)),
    copyImage: vi.fn(async () => ({ ok: true } as const)),
  };
  return { services, objectUrls };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    IMAGE_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ version: 1, data: { tutorialVersion: "0.8" } }),
  );
});

describe("built Image package preview", () => {
  it("renders snapshotted pair order/content with drag, open, and source-download fallbacks", async () => {
    const urls = registryHarness();
    const pairs = [previewPair(1), previewPair(2)];
    render(<ImagePackagePreview
      pairs={pairs}
      objectUrls={urls.registry}
      leaseEnabled
      copyPrompt={vi.fn(async () => ({ ok: true } as const))}
      copyImage={vi.fn(async () => ({ ok: true } as const))}
    />);

    const cards = screen.getAllByRole("group", { name: /built package pair/iu });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("BUILT EXACT PROMPT 1");
    expect(cards[1]).toHaveTextContent("BUILT EXACT PROMPT 2");
    expect(cards[0]).toHaveTextContent("album/built-source-1.png");
    expect(cards[0]).toHaveTextContent("OpenAI GPT Image");
    expect(cards[0]).toHaveTextContent("Built warning 1");
    const firstImage = await screen.findByRole("img", { name: "Built source built-source-1.png" });
    expect(firstImage).toHaveAttribute("draggable", "true");
    const firstCard = cards[0];
    expect(within(firstCard).getByRole("link", { name: "OPEN IMAGE" })).toHaveAttribute("href", "blob:package-preview-1");
    expect(within(firstCard).getByRole("link", { name: "DOWNLOAD IMAGE" })).toHaveAttribute("download", "source.png");
    expect(urls.created).toHaveLength(2);
  });

  it("reports truthful clipboard success and preserves/selects fallbacks after failure", async () => {
    const urls = registryHarness();
    const copyPrompt = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: "denied" });
    const copyImage = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: "conversion-failed" });
    render(<ImagePackagePreview
      pairs={[previewPair()]}
      objectUrls={urls.registry}
      leaseEnabled
      copyPrompt={copyPrompt}
      copyImage={copyImage}
    />);
    await screen.findByRole("img", { name: "Built source built-source-1.png" });

    fireEvent.click(screen.getByRole("button", { name: "COPY PROMPT" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Prompt copied.");
    fireEvent.click(screen.getByRole("button", { name: "COPY PROMPT" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Prompt selected — copy manually."));
    expect(window.getSelection()?.toString()).toBe("BUILT EXACT PROMPT 1");
    expect(screen.getByText("BUILT EXACT PROMPT 1")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "COPY IMAGE" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Image copied."));
    fireEvent.click(screen.getByRole("button", { name: "COPY IMAGE" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Copy unavailable/iu));
    expect(screen.getByRole("link", { name: "OPEN IMAGE" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "DOWNLOAD IMAGE" })).toBeInTheDocument();
  });

  it("keeps built snapshot cards for selection but clears every card and lease on material mutation", async () => {
    const harness = workbenchHarness();
    render(<ImageWorkbench services={harness.services} />);
    fireEvent.change(screen.getByLabelText("Add image files"), {
      target: { files: [new File([new Uint8Array([1])], "built-source.png", { type: "image/png" })] },
    });
    const controls = await screen.findByRole("group", { name: "built-source-1.png image controls" });
    expect(screen.queryByRole("region", { name: "Built package pairs" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM IMAGE SET" }));
    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
    expect(await screen.findByRole("region", { name: "Built package pairs" })).toHaveTextContent("BUILT EXACT PROMPT 1");
    await waitFor(() => expect(harness.objectUrls.created.some((url) => url.includes("package-preview"))).toBe(true));
    const createdBeforeSelection = [...harness.objectUrls.created];

    fireEvent.click(within(controls).getByRole("checkbox", { name: "Select built-source-1.png" }));
    expect(screen.getByRole("region", { name: "Built package pairs" })).toBeInTheDocument();
    expect(harness.objectUrls.created).toEqual(createdBeforeSelection);

    fireEvent.click(within(controls).getByRole("button", { name: "Omit built-source-1.png" }));
    expect(screen.queryByRole("region", { name: "Built package pairs" })).not.toBeInTheDocument();
    await waitFor(() => expect(harness.objectUrls.revoked).toContain(createdBeforeSelection.at(-1)));
  });
});
