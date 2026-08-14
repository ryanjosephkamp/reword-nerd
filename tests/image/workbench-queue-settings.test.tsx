import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ownImageBytes } from "../../src/image/contracts";
import type {
  BrowserImageIntakeServiceOptions,
  ImageAdmission,
  ImageIntakeService,
} from "../../src/image/intake";
import { ImageObjectUrlRegistry } from "../../src/image/objectUrlRegistry";
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
    sourceHash: `${ordinal + 1}`.repeat(64),
    width: 10 + ordinal,
    height: 20 + ordinal,
    warnings: ordinal === 1 ? ["Check transparency."] : [],
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

function harness() {
  let options!: BrowserImageIntakeServiceOptions;
  const admissions = [admission("first", "first.png", 0), admission("second", "second.png", 1)];
  const future = admission("future", "future.png", 2);
  let intakeRun = 0;
  const intake = vi.fn(async () => {
    intakeRun += 1;
    const currentAdmissions = intakeRun === 1 ? admissions : [future];
    for (const item of currentAdmissions) options.publish(item, 0);
    return {
      admissions: currentAdmissions,
      ledger: currentAdmissions.map((item) => ({
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
  const revoke = vi.fn();
  let url = 0;
  const services: ImageWorkbenchServices = {
    createIntake: (created) => { options = created; return service; },
    createOcr: () => ({ recognize: vi.fn(), cancelItem: vi.fn(), reset: vi.fn(), dispose: vi.fn() }),
    createObjectUrls: () => new ImageObjectUrlRegistry(() => `blob:queue-${++url}`, revoke),
  };
  return { services, revoke };
}

async function renderWithImages() {
  window.localStorage.setItem(
    IMAGE_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ version: 1, data: { tutorialVersion: "0.8" } }),
  );
  const value = harness();
  render(<ImageWorkbench services={value.services} />);
  const file = new File([new Uint8Array([1])], "batch.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Add image files"), { target: { files: [file] } });
  await screen.findByRole("group", { name: "second.png image controls" });
  return value;
}

describe("Image queue interaction domains", () => {
  it("keeps focus, bulk selection, and inclusion independent", async () => {
    await renderWithImages();
    const first = screen.getByRole("group", { name: "first.png image controls" });
    const second = screen.getByRole("group", { name: "second.png image controls" });
    expect(within(first).getByRole("button", { name: "Focus first.png" })).toHaveAttribute("aria-current", "true");
    expect(within(second).getByText("INCLUDED")).toBeInTheDocument();

    fireEvent.click(within(second).getByRole("checkbox", { name: "Select second.png" }));
    expect(within(second).getByRole("checkbox", { name: "Select second.png" })).toBeChecked();
    expect(within(first).getByRole("button", { name: "Focus first.png" })).toHaveAttribute("aria-current", "true");
    expect(within(second).getByText("INCLUDED")).toBeInTheDocument();

    fireEvent.click(within(second).getByRole("button", { name: "Focus second.png" }));
    expect(within(second).getByRole("button", { name: "Focus second.png" })).toHaveAttribute("aria-current", "true");
    expect(within(second).getByRole("checkbox", { name: "Select second.png" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "OMIT 1" }));
    expect(within(second).getByText("OMITTED")).toBeInTheDocument();
    expect(within(second).getByRole("checkbox", { name: "Select second.png" })).toBeChecked();
    expect(within(second).getByRole("button", { name: "Focus second.png" })).toHaveAttribute("aria-current", "true");
  });

  it("confirms selected removal and lets the reducer choose the next focus", async () => {
    await renderWithImages();
    const first = screen.getByRole("group", { name: "first.png image controls" });
    const second = screen.getByRole("group", { name: "second.png image controls" });
    fireEvent.click(within(second).getByRole("button", { name: "Focus second.png" }));
    fireEvent.click(within(second).getByRole("checkbox", { name: "Select second.png" }));
    fireEvent.click(screen.getByRole("button", { name: "REMOVE 1" }));
    const dialog = screen.getByRole("dialog", { name: "Remove images?" });
    expect(dialog).toHaveTextContent("second.png");
    fireEvent.click(within(dialog).getByRole("button", { name: "REMOVE 1 IMAGE" }));

    expect(screen.queryByRole("group", { name: "second.png image controls" })).not.toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Focus first.png" })).toHaveAttribute("aria-current", "true");
  });

  it("keeps defaults future-only and persists only validated defaults/tutorial data", async () => {
    await renderWithImages();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Default model family"), { target: { value: "midjourney" } });
    expect(screen.getByText("Midjourney V8.2")).toBeInTheDocument();

    const futureFile = new File([new Uint8Array([3])], "future.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Add image files"), { target: { files: [futureFile] } });
    await screen.findByRole("group", { name: "future.png image controls" });

    fireEvent.click(screen.getByRole("tab", { name: "SELECTED [0]" }));
    fireEvent.click(within(screen.getByRole("group", { name: "first.png image controls" })).getByRole("button", { name: "Focus first.png" }));
    expect(screen.getByLabelText("Focused model family")).toHaveValue("openai-gpt-image");
    fireEvent.click(within(screen.getByRole("group", { name: "future.png image controls" })).getByRole("button", { name: "Focus future.png" }));
    expect(screen.getByLabelText("Focused model family")).toHaveValue("midjourney");

    const serialized = window.localStorage.getItem(IMAGE_PREFERENCES_STORAGE_KEY) ?? "";
    expect(serialized).not.toContain("first.png");
    expect(serialized).not.toContain("future.png");
    const saved = JSON.parse(serialized) as { data: Record<string, unknown> };
    expect(Object.keys(saved.data).sort()).toEqual(["defaults", "tutorialVersion"]);
  });

  it("applies only checked explicit bulk fields and keeps focused overrides independent", async () => {
    await renderWithImages();
    const first = screen.getByRole("group", { name: "first.png image controls" });
    const second = screen.getByRole("group", { name: "second.png image controls" });
    fireEvent.click(within(first).getByRole("checkbox", { name: "Select first.png" }));
    fireEvent.click(within(second).getByRole("checkbox", { name: "Select second.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "SELECTED [2]" }));

    fireEvent.change(screen.getByLabelText("Focused aspect ratio"), { target: { value: "1:1" } });
    const mixed = screen.getByLabelText("Selected aspect ratio");
    expect(mixed).toHaveValue("");
    expect(within(mixed).getByRole("option", { name: "Mixed — choose a value" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply Aspect ratio" }));
    expect(screen.getByRole("button", { name: "APPLY TO 2 IMAGES" })).toBeDisabled();
    fireEvent.change(mixed, { target: { value: "16:9" } });
    expect(screen.getByRole("button", { name: "APPLY TO 2 IMAGES" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "APPLY TO 2 IMAGES" }));

    expect(screen.getByLabelText("Focused aspect ratio")).toHaveValue("16:9");
    fireEvent.click(within(second).getByRole("button", { name: "Focus second.png" }));
    expect(screen.getByLabelText("Focused aspect ratio")).toHaveValue("16:9");
    expect(screen.getByLabelText("Focused model family")).toHaveValue("openai-gpt-image");
    expect(within(second).getByRole("checkbox", { name: "Select second.png" })).toBeChecked();

    fireEvent.change(screen.getByLabelText("Focused requested changes"), { target: { value: "Warm evening light" } });
    expect(screen.getByLabelText("Focused requested changes")).toHaveValue("Warm evening light");
    expect(within(second).getByText("INCLUDED")).toBeInTheDocument();
  });

  it("shows stable family labels separately from dated Midjourney metadata", async () => {
    await renderWithImages();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "SELECTED [0]" }));
    fireEvent.change(screen.getByLabelText("Focused model family"), { target: { value: "midjourney" } });

    expect(screen.getByLabelText("Focused model family")).toHaveDisplayValue("Midjourney");
    expect(screen.getByText("Midjourney V8.2")).toBeInTheDocument();
    expect(screen.getByText(/best-effort influence rather than exact reconstruction/iu)).toBeInTheDocument();
  });
});
