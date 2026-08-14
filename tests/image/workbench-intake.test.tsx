import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ownImageBytes } from "../../src/image/contracts";
import type {
  BrowserImageIntakeServiceOptions,
  ImageAdmission,
  ImageIntakeService,
  ImagePdfCaptureChoice,
} from "../../src/image/intake";
import { ImageObjectUrlRegistry } from "../../src/image/objectUrlRegistry";
import { IMAGE_PREFERENCES_STORAGE_KEY } from "../../src/image/preferences";
import { ImageWorkbench } from "../../src/image/workbench/ImageWorkbench";
import { ImagePdfCaptureDialog } from "../../src/image/workbench/ImagePdfCaptureDialog";
import { parseImagePdfPages } from "../../src/image/workbench/pdfPages";
import type { ImageWorkbenchServices } from "../../src/image/workbench/services";

function componentHarness() {
  let options!: BrowserImageIntakeServiceOptions;
  const item: ImageAdmission = {
    id: "component-occurrence",
    ordinal: 0,
    sourceBytes: ownImageBytes(new Uint8Array([1, 2, 3]), "image/png"),
    byteCount: 3,
    mimeType: "image/png",
    fileExtension: "png",
    sourceHash: "b".repeat(64),
    width: 12,
    height: 8,
    warnings: [],
    provenance: {
      intakeKind: "direct",
      sourceName: "component.png",
      sourcePath: null,
      containerChain: [],
      containerName: null,
      containerHash: null,
      containerPath: null,
      pageNumber: null,
      relationshipId: null,
    },
  };
  const intake = vi.fn(async () => {
    options.publish(item, 0);
    return {
      admissions: [item],
      ledger: [{ inputName: "component.png", path: null, status: "accepted" as const, occurrenceId: item.id, issue: null }],
    };
  });
  const intakeFolder = vi.fn(async () => ({ admissions: [], ledger: [] }));
  const service: ImageIntakeService = {
    intake,
    intakeFolder,
    reconcile: vi.fn(),
    reset: vi.fn(),
    snapshot: () => ({ count: 0, bytes: 0, sessionEpoch: 0 }),
  };
  const services: ImageWorkbenchServices = {
    createIntake: (created) => { options = created; return service; },
    createOcr: () => ({ recognize: vi.fn(), cancelItem: vi.fn(), reset: vi.fn(), dispose: vi.fn() }),
    createObjectUrls: () => new ImageObjectUrlRegistry(() => "blob:component", () => undefined),
    buildPackage: vi.fn(async () => ({ ok: false, error: { code: "INVALID_SNAPSHOT", message: "Not used in this test." } } as const)),
    downloadPackage: vi.fn(() => ({ ok: false, message: "Not used in this test." } as const)),
    copyPrompt: vi.fn(async () => ({ ok: false, reason: "unavailable" } as const)),
    copyImage: vi.fn(async () => ({ ok: false, reason: "unavailable" } as const)),
  };
  return { services, intake, intakeFolder };
}

describe("Image intake UI", () => {
  it("routes the real file and folder controls through the top-level facade and reports its ledger", async () => {
    window.localStorage.setItem(
      IMAGE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, data: { tutorialVersion: "0.8" } }),
    );
    const harness = componentHarness();
    render(<ImageWorkbench services={harness.services} />);
    const direct = new File([new Uint8Array([1, 2, 3])], "component.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Add image files"), { target: { files: [direct] } });
    await screen.findByText("component.png — ACCEPTED");
    expect(harness.intake).toHaveBeenCalledWith([direct]);

    const folder = new File([new Uint8Array([4])], "folder.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Add image folder"), { target: { files: [folder] } });
    await act(async () => undefined);
    expect(harness.intakeFolder).toHaveBeenCalledWith([folder]);
  });

  it("parses PDF page selections as sorted unique bounded integers", () => {
    expect(parseImagePdfPages("3, 1-2, 2", 3)).toEqual([1, 2, 3]);
    expect(parseImagePdfPages("0,1", 3)).toBeNull();
    expect(parseImagePdfPages("1-4", 3)).toBeNull();
    expect(parseImagePdfPages("2-1", 3)).toBeNull();
    expect(parseImagePdfPages("1.5", 3)).toBeNull();
  });

  it("returns an explicit PDF capture choice and restores its invoking control after choose, close, and Escape", async () => {
    const choices: ImagePdfCaptureChoice[] = [];
    const Harness = () => {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return <>
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>OPEN PDF CAPTURE</button>
        {open ? <ImagePdfCaptureDialog
          open
          request={{ inputName: "portfolio.pdf", path: "docs/portfolio.pdf", pageCount: 4 }}
          returnFocusRef={triggerRef}
          onChoose={(choice) => { choices.push(choice); setOpen(false); }}
        /> : null}
      </>;
    };
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "OPEN PDF CAPTURE" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Capture PDF pages" })).toHaveTextContent("portfolio.pdf");
    expect(screen.getByRole("dialog", { name: "Capture PDF pages" })).toHaveTextContent("4 pages");
    fireEvent.click(screen.getByRole("radio", { name: "EMBEDDED + SELECTED PAGES" }));
    fireEvent.change(screen.getByLabelText("PDF pages"), { target: { value: "4,1-2" } });
    fireEvent.click(screen.getByRole("radio", { name: "HIGH" }));
    fireEvent.click(screen.getByRole("button", { name: "USE PDF CHOICE" }));
    expect(choices).toEqual([{ mode: "embedded-and-pages", pages: [1, 2, 4], quality: "high" }]);
    await act(async () => undefined);
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Use embedded PDF images only" }));
    expect(choices.at(-1)).toEqual({ mode: "embedded-only" });
    await act(async () => undefined);
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    act(() => { fireEvent.keyDown(screen.getByRole("dialog", { name: "Capture PDF pages" }), { key: "Escape" }); });
    expect(choices.at(-1)).toEqual({ mode: "embedded-only" });
    await act(async () => undefined);
    expect(trigger).toHaveFocus();
  });

  it("keeps an invalid page choice open with an accessible error", () => {
    const choose = vi.fn();
    render(<ImagePdfCaptureDialog
      open
      request={{ inputName: "one.pdf", path: null, pageCount: 1 }}
      onChoose={choose}
    />);
    fireEvent.click(screen.getByRole("radio", { name: "EMBEDDED + SELECTED PAGES" }));
    fireEvent.change(screen.getByLabelText("PDF pages"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "USE PDF CHOICE" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter pages from 1 to 1");
    expect(choose).not.toHaveBeenCalled();
  });
});
