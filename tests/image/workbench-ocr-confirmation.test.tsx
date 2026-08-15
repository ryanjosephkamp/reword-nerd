import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ownImageBytes } from "../../src/image/contracts";
import type {
  BrowserImageIntakeServiceOptions,
  ImageAdmission,
  ImageIntakeService,
} from "../../src/image/intake";
import { ImageObjectUrlRegistry } from "../../src/image/objectUrlRegistry";
import type { ImageOcrJob, ImageOcrResult } from "../../src/image/ocrService";
import { IMAGE_PREFERENCES_STORAGE_KEY } from "../../src/image/preferences";
import { ImageWorkbench } from "../../src/image/workbench/ImageWorkbench";
import type { ImageWorkbenchServices } from "../../src/image/workbench/services";

function admission(id: string, name: string, ordinal: number): ImageAdmission {
  return {
    id,
    ordinal,
    sourceBytes: ownImageBytes(new Uint8Array([ordinal + 1]), "image/png"),
    byteCount: 1,
    mimeType: "image/png",
    fileExtension: "png",
    sourceHash: `${ordinal + 4}`.repeat(64),
    width: 20,
    height: 10,
    warnings: [],
    provenance: {
      intakeKind: "direct",
      sourceName: name,
      sourcePath: null,
      containerChain: [],
      containerName: null,
      containerHash: null,
      containerPath: null,
      pageNumber: null,
      relationshipId: null,
    },
  };
}

function harness(recognizeImpl: (job: ImageOcrJob) => Promise<ImageOcrResult>) {
  let options!: BrowserImageIntakeServiceOptions;
  const admissions = [admission("first", "first.png", 0), admission("second", "second.png", 1)];
  const intake = vi.fn(async () => {
    admissions.forEach((item) => options.publish(item, 0));
    return {
      admissions,
      ledger: admissions.map((item) => ({
        inputName: item.provenance.sourceName,
        path: null,
        status: "accepted" as const,
        occurrenceId: item.id,
        issue: null,
      })),
    };
  });
  const service: ImageIntakeService = {
    intake,
    intakeFolder: vi.fn(async () => ({ admissions: [], ledger: [] })),
    reconcile: vi.fn(),
    reset: vi.fn(),
    snapshot: () => ({ count: 0, bytes: 0, sessionEpoch: 0 }),
  };
  const recognize = vi.fn(recognizeImpl);
  const cancelItem = vi.fn(async () => undefined);
  const reset = vi.fn(async () => undefined);
  const services: ImageWorkbenchServices = {
    createIntake: (created) => { options = created; return service; },
    createOcr: () => ({ recognize, cancelItem, reset, dispose: vi.fn(async () => undefined) }),
    createObjectUrls: () => new ImageObjectUrlRegistry(() => "blob:ocr", () => undefined),
    buildPackage: vi.fn(async () => ({ ok: false, error: { code: "INVALID_SNAPSHOT", message: "Not used in this test." } } as const)),
    downloadPackage: vi.fn(() => ({ ok: false, message: "Not used in this test." } as const)),
    copyPrompt: vi.fn(async () => ({ ok: false, reason: "unavailable" } as const)),
    copyImage: vi.fn(async () => ({ ok: false, reason: "unavailable" } as const)),
  };
  return { services, admissions, recognize, cancelItem, reset };
}

async function renderSession(recognizeImpl: (job: ImageOcrJob) => Promise<ImageOcrResult>) {
  window.localStorage.setItem(
    IMAGE_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ version: 1, data: { tutorialVersion: "0.8-image-quick-start" } }),
  );
  const value = harness(recognizeImpl);
  render(<ImageWorkbench services={value.services} />);
  fireEvent.change(screen.getByLabelText("Add image files"), {
    target: { files: [new File([new Uint8Array([1])], "batch.png", { type: "image/png" })] },
  });
  await screen.findByRole("group", { name: "second.png image controls" });
  return value;
}

describe("Image OCR review and confirmation", () => {
  it("uses the exact OCR custody token and includes reviewed text in Prompt only after acceptance", async () => {
    const marker = "VISIBLE PRIVATE MARKER";
    const value = await renderSession(async (job) => ({ token: job.token, detectedText: marker }));
    const prompt = screen.getByRole("region", { name: "Prompt prose" });
    const runCard = screen.getByRole("region", { name: "Provider run card" });
    expect(prompt).not.toHaveTextContent(marker);
    expect(runCard).toHaveTextContent("# Provider run card");

    fireEvent.click(screen.getByRole("button", { name: "RUN OCR" }));
    await screen.findByText("NEEDS REVIEW");
    expect(value.recognize).toHaveBeenCalledOnce();
    const job = value.recognize.mock.calls[0][0];
    expect(job.token).toEqual({
      sessionGeneration: 0,
      itemId: "first",
      itemIncarnation: 1,
      sourceHash: value.admissions[0].sourceHash,
      ocrGeneration: 1,
    });
    expect(job.sourceBytes).toBe(value.admissions[0].sourceBytes);
    expect(screen.getByLabelText("Detected OCR text")).toHaveValue(marker);
    expect(prompt).not.toHaveTextContent(marker);

    fireEvent.change(screen.getByLabelText("Reviewed OCR text"), { target: { value: `${marker} REVIEWED` } });
    fireEvent.click(screen.getByRole("button", { name: "ACCEPT REVIEWED OCR" }));
    expect(screen.getByText("OCR ACCEPTED")).toBeInTheDocument();
    expect(prompt).toHaveTextContent(JSON.stringify(`${marker} REVIEWED`));
    expect(runCard).not.toHaveTextContent(marker);
  });

  it("queues selected OCR serially in item order", async () => {
    const order: string[] = [];
    await renderSession(async (job) => {
      order.push(job.token.itemId);
      return { token: job.token, detectedText: `text-${job.token.itemId}` };
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select first.png" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select second.png" }));
    fireEvent.click(screen.getByRole("button", { name: "RUN OCR ON 2" }));
    await waitFor(() => expect(screen.getByLabelText("Detected OCR text")).toHaveValue("text-first"));
    expect(order).toEqual(["first", "second"]);
  });

  it("accepts exactly 20,000 code points and refuses an over-limit reviewed draft", async () => {
    await renderSession(async (job) => ({ token: job.token, detectedText: "detected" }));
    fireEvent.click(screen.getByRole("button", { name: "RUN OCR" }));
    await screen.findByText("NEEDS REVIEW");
    const textarea = screen.getByLabelText("Reviewed OCR text");
    fireEvent.change(textarea, { target: { value: "😀".repeat(20_001) } });
    expect(screen.getByText("20,001 / 20,000 code points")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ACCEPT REVIEWED OCR" })).toBeDisabled();
    expect(screen.getByText(/shorten the reviewed OCR before accepting/iu)).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "😀".repeat(20_000) } });
    expect(screen.getByText("20,000 / 20,000 code points")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ACCEPT REVIEWED OCR" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "ACCEPT REVIEWED OCR" }));
    expect(screen.getByText("OCR ACCEPTED")).toBeInTheDocument();
  });

  it("uses included-only blockers, confirms once, and invalidates after a material change", async () => {
    await renderSession(async (job) => ({ token: job.token, detectedText: "omitted review" }));
    const second = screen.getByRole("group", { name: "second.png image controls" });
    fireEvent.click(within(second).getByRole("button", { name: "Focus second.png" }));
    fireEvent.click(within(second).getByRole("button", { name: "Omit second.png" }));
    fireEvent.click(screen.getByRole("button", { name: "RUN OCR" }));
    await screen.findByText("NEEDS REVIEW");

    expect(screen.getByText("Ready to confirm the current image set.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM IMAGE SET" }));
    expect(screen.getByText("Image set confirmed for the current review generation.")).toBeInTheDocument();
    expect(screen.getByText(/creates a local ZIP in memory/iu)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeDisabled();
    expect(screen.getByText("No package has been built.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "SELECTED [0]" }));
    fireEvent.change(screen.getByLabelText("Focused requested changes"), { target: { value: "One safe change" } });
    expect(screen.getByText("Ready to confirm the current image set.")).toBeInTheDocument();
    expect(screen.queryByText("Image set confirmed for the current review generation.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeDisabled();
  });

  it("shows failed OCR retry and cancels item/reset work through owned services", async () => {
    const value = await renderSession(async () => { throw new Error("worker failed"); });
    fireEvent.click(screen.getByRole("button", { name: "RUN OCR" }));
    await screen.findByText("OCR FAILED");
    expect(screen.getByRole("button", { name: "RETRY OCR" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove first.png" }));
    fireEvent.click(screen.getByRole("button", { name: "REMOVE 1 IMAGE" }));
    expect(value.cancelItem).toHaveBeenCalledWith("first", value.admissions[0].sourceHash);
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Start a new Image session?" }))
      .getByRole("button", { name: "CLEAR IMAGE SESSION" }));
    expect(value.reset).toHaveBeenCalled();
  });
});
