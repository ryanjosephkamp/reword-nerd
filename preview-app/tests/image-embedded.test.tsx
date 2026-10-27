import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ownImageBytes } from "../src/image/contracts";
import { buildImagePromptPackage } from "../src/image/export";
import type { BrowserImageIntakeServiceOptions, ImageAdmission, ImageIntakeService, ImagePdfCaptureChoice } from "../src/image/intake";
import { ImageObjectUrlRegistry } from "../src/image/objectUrlRegistry";
import { IMAGE_PREFERENCES_STORAGE_KEY } from "../src/image/preferences";
import { ImageWorkbench } from "../src/image/workbench/ImageWorkbench";
import type { ImageWorkbenchServices } from "../src/image/workbench/services";
import { useImageObjectUrl } from "../src/image/workbench/useImageObjectUrl";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(IMAGE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, data: { tutorialVersion: "0.8-image-quick-start" } }));
});
afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function harness() {
  let options!: BrowserImageIntakeServiceOptions;
  const sourceBytes = ownImageBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), "image/png");
  const item: ImageAdmission = {
    id: "retained-image", ordinal: 0, sourceBytes, byteCount: sourceBytes.size,
    mimeType: "image/png", fileExtension: "png", sourceHash: "a".repeat(64), width: 3, height: 2, warnings: [],
    provenance: { intakeKind: "direct", sourceName: "garden.png", sourcePath: null, containerChain: [], containerName: null, containerHash: null, containerPath: null, pageNumber: null, relationshipId: null },
  };
  const reset = vi.fn();
  const service: ImageIntakeService = {
    intake: vi.fn<ImageIntakeService["intake"]>(async () => {
      options.publish(item, 0);
      return { admissions: [item], ledger: [{ inputName: "garden.png", path: null, status: "accepted", occurrenceId: item.id, issue: null }] };
    }),
    intakeFolder: vi.fn(async () => ({ admissions: [], ledger: [] })),
    reconcile: vi.fn(), reset, snapshot: () => ({ count: 0, bytes: 0, sessionEpoch: 0 }),
  };
  const dispose = vi.fn(async () => undefined);
  const copyPrompt = vi.fn<ImageWorkbenchServices["copyPrompt"]>(async () => ({ ok: false, reason: "unavailable" } as const));
  const downloadPackage = vi.fn<ImageWorkbenchServices["downloadPackage"]>(() => ({ ok: true } as const));
  const buildPackage = vi.fn<ImageWorkbenchServices["buildPackage"]>((snapshot, buildOptions) => buildImagePromptPackage(snapshot, {
    ...buildOptions,
    hash: async () => "a".repeat(64),
    decoder: { decode: async () => ({ width: 3, height: 2, close: () => undefined }) },
    // Exercise the production snapshot/prompt path; archive byte transport is independently tested.
    createArchive: () => ({ add: () => undefined, close: async () => new Blob(["test archive"], { type: "application/zip" }) }),
  }));
  const services: ImageWorkbenchServices = {
    createIntake: (created) => { options = created; return service; },
    createOcr: () => ({ recognize: vi.fn(async (job) => ({ token: job.token, detectedText: "GARDEN" })), cancelItem: vi.fn(async () => undefined), reset: vi.fn(async () => undefined), dispose }),
    createObjectUrls: () => new ImageObjectUrlRegistry(() => "blob:retained-image", () => undefined),
    buildPackage,
    downloadPackage, copyPrompt, copyImage: vi.fn(async () => ({ ok: false, reason: "unavailable" } as const)),
  };
  return { services, reset, dispose, item, buildPackage, copyPrompt, downloadPackage, options: () => options };
}

function view(services: ImageWorkbenchServices, active: boolean) {
  return <><button type="button">Other workspace</button><ImageWorkbench embedded active={active} services={services} /></>;
}

it("embeds session utilities without the legacy brand or portal switcher", () => {
  const value = harness();
  const { container } = render(view(value.services, true));
  expect(container.querySelector(".brand-portal")).toBeNull();
  expect(screen.queryByRole("main")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Image workspace" })).toHaveClass("platform-embedded");
  for (const name of ["Open files", "New session", "Settings", "Help", "Info", "Share"]) expect(screen.getByRole("button", { name })).toBeEnabled();
});

it("retains exact source, model settings, accepted OCR and the ready package through inactive mode", async () => {
  const value = harness();
  const { rerender, container } = render(view(value.services, true));
  fireEvent.change(screen.getByLabelText("Add image files"), { target: { files: [new File(["local input"], "garden.png", { type: "image/png" })] } });
  await screen.findByRole("group", { name: "garden.png image controls" });
  fireEvent.click(screen.getByRole("button", { name: "SELECTED [0]" }));
  fireEvent.change(screen.getByLabelText("Focused requested changes"), { target: { value: "Keep the original framing." } });
  const model = screen.getByLabelText("Focused prompt guidance") as HTMLSelectElement;
  const selectedModel = model.options[1].value;
  fireEvent.change(model, { target: { value: selectedModel } });
  fireEvent.click(screen.getByRole("button", { name: "RUN OCR" }));
  await screen.findByText("NEEDS REVIEW");
  fireEvent.change(screen.getByLabelText("Reviewed OCR text"), { target: { value: "GARDEN — reviewed" } });
  fireEvent.click(screen.getByRole("button", { name: "ACCEPT REVIEWED OCR" }));
  fireEvent.click(screen.getByRole("button", { name: "CONFIRM IMAGE SET" }));
  fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeEnabled());
  const root = screen.getByRole("region", { name: "Image workspace" });
  const originalPrompt = screen.getByRole("region", { name: "Prompt prose" }).textContent;
  const packageCard = screen.getByRole("group", { name: "garden.png built package pair" });
  let finishCopy!: (result: Awaited<ReturnType<ImageWorkbenchServices["copyPrompt"]>>) => void;
  value.copyPrompt.mockImplementationOnce(() => new Promise((resolve) => { finishCopy = resolve; }));
  fireEvent.click(within(packageCard).getByRole("button", { name: "COPY PROMPT" }));
  const external = screen.getByRole("button", { name: "Other workspace" });
  external.focus();
  await act(async () => rerender(view(value.services, false)));
  await act(async () => finishCopy({ ok: false, reason: "unavailable" }));
  expect(root).toHaveAttribute("hidden");
  expect(root).toHaveAttribute("inert");
  expect(container.querySelector(".image-workbench")).toBe(root);
  expect(packageCard).toBeInTheDocument();
  expect(external).toHaveFocus();
  expect(value.reset).not.toHaveBeenCalled();
  expect(value.dispose).not.toHaveBeenCalled();
  await act(async () => rerender(view(value.services, true)));
  expect(screen.getByLabelText("Focused requested changes")).toHaveValue("Keep the original framing.");
  expect(screen.getByLabelText("Focused prompt guidance")).toHaveValue(selectedModel);
  expect(screen.getByText("OCR ACCEPTED")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Prompt prose" }).textContent).toBe(originalPrompt);
  expect(screen.getByRole("group", { name: "garden.png built package pair" })).toBe(packageCard);
  fireEvent.click(screen.getByRole("button", { name: "DOWNLOAD ZIP" }));
  expect(value.downloadPackage).toHaveBeenCalledOnce();
  expect(new Uint8Array(await value.buildPackage.mock.calls[0][0].items[0].sourceBytes.arrayBuffer()))
    .toEqual(new Uint8Array(await value.item.sourceBytes.arrayBuffer()));
  const built = await value.buildPackage.mock.results[0].value;
  expect(built.ok).toBe(true);
  if (built.ok) expect(value.downloadPackage.mock.calls[0][0]).toBe(built.output.packageBytes);
});

it("keeps a pending PDF choice dormant while inactive and restores its draft on return", async () => {
  const value = harness();
  const { rerender } = render(view(value.services, true));
  const outside = screen.getByRole("button", { name: "Other workspace" });
  rerender(view(value.services, false));
  outside.focus();
  let choice!: Promise<ImagePdfCaptureChoice | undefined>;
  act(() => { choice = Promise.resolve(value.options().resolvePdfCapture?.({ inputName: "garden.pdf", path: null, pageCount: 4, signal: new AbortController().signal })); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(outside).toHaveFocus();
  rerender(view(value.services, true));
  const dialog = screen.getByRole("dialog", { name: "Capture PDF pages" });
  fireEvent.click(within(dialog).getByRole("radio", { name: "EMBEDDED + SELECTED PAGES" }));
  fireEvent.change(screen.getByLabelText("PDF pages"), { target: { value: "2,4" } });
  fireEvent.click(screen.getByRole("radio", { name: "HIGH" }));
  rerender(view(value.services, false));
  outside.focus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => undefined);
  expect(outside).toHaveFocus();
  rerender(view(value.services, true));
  expect(screen.getByLabelText("PDF pages")).toHaveValue("2,4");
  expect(screen.getByRole("radio", { name: "HIGH" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "USE PDF CHOICE" }));
  await expect(choice).resolves.toEqual({ mode: "embedded-and-pages", pages: [2, 4], quality: "high" });
  expect(value.reset).not.toHaveBeenCalled();
});

it("does not focus the first-run tutorial before its workspace becomes active", () => {
  window.localStorage.clear();
  const value = harness();
  const { rerender } = render(view(value.services, false));
  const outside = screen.getByRole("button", { name: "Other workspace" });
  outside.focus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(outside).toHaveFocus();
  rerender(view(value.services, true));
  expect(screen.getByRole("dialog", { name: "Image Quick Start" })).toHaveFocus();
});

it("never commits a revoked image URL while a retained view resumes", async () => {
  let counter = 0;
  const revoked = new Set<string>();
  const registry = new ImageObjectUrlRegistry(() => `blob:lease-${++counter}`, (url) => revoked.add(url));
  const sourceBytes = new Blob(["retained source"]);
  const commits: Array<string | null> = [];
  function Preview({ enabled }: { enabled: boolean }) {
    const url = useImageObjectUrl(registry, { occurrenceId: "image", sourceHash: "hash", purpose: "focused", sourceBytes, enabled });
    useLayoutEffect(() => { commits.push(url); });
    return url ? <img src={url} alt="Retained preview" /> : null;
  }
  const { rerender } = render(<Preview enabled />);
  await screen.findByRole("img", { name: "Retained preview" });
  expect(screen.getByRole("img")).toHaveAttribute("src", "blob:lease-1");
  rerender(<Preview enabled={false} />);
  expect(revoked.has("blob:lease-1")).toBe(true);
  commits.length = 0;
  rerender(<Preview enabled />);
  await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:lease-2"));
  expect(commits).toContain("blob:lease-2");
  expect(commits.every((url) => url === null || !revoked.has(url))).toBe(true);
});
