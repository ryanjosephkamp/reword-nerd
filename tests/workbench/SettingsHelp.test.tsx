import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "../../src/app/App";
import { SettingsInspector } from "../../src/app/workbench/components/SettingsInspector";
import type { WorkbenchServices } from "../../src/app/workbench/contracts";
import { createInitialWorkbenchState } from "../../src/app/workbench/reducer";
import { CURRENT_TUTORIAL_VERSION, PREFERENCES_STORAGE_KEY } from "../../src/app/workbench/preferences";

function services(): WorkbenchServices {
  return {
    createDocumentId: () => "document-0",
    preflight: async () => [],
    extract: async () => ({
      format: "markdown",
      extractedText: "",
      warnings: [],
      originalHash: "original-hash",
      extractedTextHash: "text-hash",
      requiresReview: true,
    }),
    hashText: async (text) => `hash:${text}`,
    buildPackage: async () => ({ ok: false, error: { code: "ARCHIVE_GENERATION_FAILED", message: "unused" } }),
    download: () => ({ ok: true }),
    downloadProgressCopy: () => ({ ok: true }),
  };
}

beforeEach(() => {
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
    version: 1,
    data: { tutorialVersion: CURRENT_TUTORIAL_VERSION },
  }));
});

afterEach(() => window.localStorage.clear());

describe("Settings help", () => {
  it("opens descriptive Tone help without changing its setting", () => {
    // This catches a missing field-level explanation or a help trigger that mutates the selected setting.
    render(<App services={services()} />);

    const tone = screen.getByLabelText("Tone");
    fireEvent.change(tone, { target: { value: "academic" } });
    fireEvent.click(screen.getByRole("button", { name: "Help about Tone" }));

    const popover = screen.getByRole("dialog", { name: "Help about Tone" });
    expect(popover).toHaveTextContent("Choose Preserve source, Academic, Professional, Technical, or Plain voice.");
    expect(tone).toHaveValue("academic");
  });

  it("connects an open help trigger to its tooltip", () => {
    // This catches an accessible tooltip that is visually present but not associated with its trigger.
    render(<App services={services()} />);

    const trigger = screen.getByRole("button", { name: "Help about Context limit" });
    fireEvent.focus(trigger);

    expect(trigger).toHaveAttribute("aria-controls", screen.getByRole("tooltip").id);
    expect(trigger).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
    fireEvent.blur(trigger, { relatedTarget: screen.getByLabelText("Tone") });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("pins one help popover at a time and dismisses it with Escape or outside activation", () => {
    // This catches help getting stuck open, competing popovers, or Escape/outside activation leaking into settings behavior.
    render(<App services={services()} />);

    fireEvent.click(screen.getByRole("button", { name: "Help about Tone" }));
    expect(screen.getByRole("dialog", { name: "Help about Tone" })).toHaveTextContent("Choose Preserve source, Academic, Professional, Technical, or Plain voice.");

    fireEvent.click(screen.getByRole("button", { name: "Help about Formality" }));
    expect(screen.getByRole("dialog", { name: "Help about Formality" })).toHaveTextContent("Choose Preserve source, Standard, or Formal register.");

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Help about Formality" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Help about Formality" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Help about Length" }));
    fireEvent.pointerDown(screen.getByLabelText("Tone"));
    expect(screen.queryByRole("dialog", { name: "Help about Length" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Help about Length" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Help about Length" })).not.toBeInTheDocument();
  });

  it("closes pinned help from its explicit close control", () => {
    // This catches a pinned popover without a usable touch-safe close route.
    render(<App services={services()} />);

    fireEvent.click(screen.getByRole("button", { name: "Help about OCR" }));
    fireEvent.click(screen.getByRole("button", { name: "Close setting help" }));

    expect(screen.queryByRole("dialog", { name: "Help about OCR" })).not.toBeInTheDocument();
  });

  it("gives separate SettingsInspector instances distinct control and tooltip IDs", () => {
    // This catches duplicate DOM IDs when desktop Settings and the drawer are both mounted.
    const state = createInitialWorkbenchState(null);
    const inspectorProps = {
      state,
      onGlobalChange: () => undefined,
      onOverrideEnabled: () => undefined,
      onOverrideChange: () => undefined,
      onProfileSelected: () => undefined,
      onProfileLabel: () => undefined,
      onContextDraft: () => undefined,
      onExtractionOptionsChange: () => undefined,
      onResetPreferences: () => undefined,
    };
    render(<><SettingsInspector {...inspectorProps} /><SettingsInspector {...inspectorProps} /></>);

    const toneControls = screen.getAllByLabelText("Tone");
    const helpControls = screen.getAllByRole("button", { name: "Help about Tone" });
    expect(toneControls[0].id).not.toBe(toneControls[1].id);
    expect(helpControls[0].getAttribute("aria-controls")).not.toBe(helpControls[1].getAttribute("aria-controls"));
  });
});
