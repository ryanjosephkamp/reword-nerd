import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Workbench } from "../src/app/workbench/Workbench";
import type { WorkbenchServices } from "../src/app/workbench/contracts";
import { CURRENT_TUTORIAL_VERSION, PREFERENCES_STORAGE_KEY } from "../src/app/workbench/preferences";

const source = "Reviewed source keeps its original meaning.";
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, data: { tutorialVersion: CURRENT_TUTORIAL_VERSION } }));
  window.matchMedia = undefined as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.localStorage.clear();
});

function services(overrides: Partial<WorkbenchServices> = {}): WorkbenchServices {
  let nextId = 0;
  return {
    createDocumentId: () => `embedded-${nextId++}`,
    preflight: vi.fn(async (files: Parameters<WorkbenchServices["preflight"]>[0]) => files.map((file) => ({ accepted: true as const, file, format: "markdown" as const, originalBytes: new TextEncoder().encode(source).buffer }))),
    extract: vi.fn(async () => ({ format: "markdown" as const, extractedText: source, warnings: [], originalHash: "original", extractedTextHash: "reviewed", requiresReview: true })),
    hashText: async (text) => `hash:${text}`,
    buildPackage: async () => ({ ok: true, blob: new Blob(["test package"]), filename: "reword-nerd-prompt-package.zip", manifest: {} as never, workbooks: [], artifacts: [] }),
    download: () => ({ ok: true }),
    downloadProgressCopy: () => ({ ok: true }),
    ...overrides,
  };
}

async function addDocument() {
  fireEvent.change(screen.getByLabelText("Add supported files"), { target: { files: [new File([source], "notes.md", { type: "text/markdown" })] } });
  await screen.findByDisplayValue(source);
}

describe("embedded workbench activity", () => {
  it("uses the platform workspace label and retains utilities without another brand or portal switcher", () => {
    window.localStorage.clear();
    const view = render(<Workbench embedded workspaceLabel="Projects" services={services()} />);
    expect(screen.getByRole("region", { name: "Projects" })).toHaveClass("workbench-embedded");
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(view.container.querySelector(".brand-portal")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    for (const name of ["Open files", "Settings", "Help", "New session"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  it("retains the same source, review and settings when hidden and relabeled for text processing", async () => {
    const adapter = services();
    const view = render(<Workbench embedded active workspaceLabel="Projects" services={adapter} />);
    await addDocument();
    fireEvent.change(screen.getByLabelText("Custom requirements"), { target: { value: "Keep names and dates." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeEnabled());
    view.rerender(<Workbench embedded active={false} workspaceLabel="Text processing" services={adapter} />);
    expect(view.container.querySelector(".workbench")).toHaveAttribute("hidden");
    expect(view.container.querySelector(".workbench")).toHaveAttribute("inert");
    view.rerender(<Workbench embedded active workspaceLabel="Text processing" services={adapter} />);
    expect(screen.getByDisplayValue(source)).toBeInTheDocument();
    expect(screen.getByLabelText("Custom requirements")).toHaveValue("Keep names and dates.");
    expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeEnabled();
    expect(screen.getAllByRole("option", { name: /notes.md/u })).toHaveLength(1);
    expect(adapter.preflight).toHaveBeenCalledTimes(1);
    expect(adapter.extract).toHaveBeenCalledTimes(1);
  });

  it("closes hidden modal and utility menus without taking focus or capturing Escape", async () => {
    const adapter = services();
    const ui = (active: boolean) => <><button type="button">Another workspace</button><Workbench embedded active={active} services={adapter} /></>;
    const view = render(ui(true));
    await addDocument();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("button", { name: "File actions for notes.md" }));
    const outside = screen.getByRole("button", { name: "Another workspace" });
    outside.focus();
    view.rerender(ui(false));
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    expect(document.dispatchEvent(escape)).toBe(true);
    expect(outside).toHaveFocus();
    view.rerender(ui(true));
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "File actions for notes.md" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    outside.focus();
    view.rerender(ui(false));
    await act(async () => { await Promise.resolve(); });
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(outside).toHaveFocus();
    view.rerender(ui(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets an owned export finish in an inactive workspace without stealing focus or replaying its focus request", async () => {
    let finish!: (result: Awaited<ReturnType<WorkbenchServices["buildPackage"]>>) => void;
    const deferred = new Promise<Awaited<ReturnType<WorkbenchServices["buildPackage"]>>>((resolve) => { finish = resolve; });
    const adapter = services({ buildPackage: vi.fn(() => deferred) });
    const ui = (active: boolean) => <><button type="button">Another workspace</button><Workbench embedded active={active} services={adapter} /></>;
    const view = render(ui(true));
    await addDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    fireEvent.click(await screen.findByRole("button", { name: "BUILD PACKAGE" }));
    const outside = screen.getByRole("button", { name: "Another workspace" });
    outside.focus();
    view.rerender(ui(false));
    await act(async () => { finish(await services().buildPackage([])); });
    expect(outside).toHaveFocus();
    expect(adapter.buildPackage).toHaveBeenCalledTimes(1);
    view.rerender(ui(true));
    expect(outside).toHaveFocus();
    expect(screen.getByRole("heading", { name: "PACKAGE PREVIEW" })).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeEnabled();
  });
});
