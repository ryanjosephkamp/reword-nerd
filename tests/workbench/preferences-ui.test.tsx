import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../../src/app/App";
import type { WorkbenchServices } from "../../src/app/workbench/contracts";
import {
  CURRENT_TUTORIAL_VERSION,
  PREFERENCES_STORAGE_KEY,
} from "../../src/app/workbench/preferences";

function services(): WorkbenchServices {
  let id = 0;
  return {
    createDocumentId: () => `id-${id++}`,
    preflight: async (files) => files.map((file) => ({
      accepted: true as const,
      file,
      format: "markdown" as const,
      originalBytes: new TextEncoder().encode("Source").buffer,
    })),
    extract: async (accepted) => ({
      format: accepted.format,
      extractedText: "Source",
      warnings: [],
      originalHash: "original-hash",
      extractedTextHash: "text-hash",
      requiresReview: true,
    }),
    hashText: async (text) => `hash:${text}`,
    buildPackage: async () => ({
      ok: false as const,
      error: { code: "ARCHIVE_GENERATION_FAILED" as const, message: "unused" },
    }),
    download: () => ({ ok: true }),
    downloadProgressCopy: () => ({ ok: true }),
  };
}

function markTutorialSeen(): void {
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
    version: 1,
    data: { tutorialVersion: CURRENT_TUTORIAL_VERSION },
  }));
}

afterEach(() => {
  window.localStorage.clear();
});

describe("saved preferences and onboarding UI", () => {
  it("shows Quick start only for an unseen tutorial and records dismissal while trapping focus", () => {
    // This catches onboarding appearing every visit, failing to record Close/Escape, or leaking keyboard focus.
    render(<App services={services()} />);

    const dialog = screen.getByRole("dialog", { name: "Quick start" });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent(/One-shot/i);
    expect(dialog).toHaveTextContent(/Manual/i);
    const close = within(dialog).getByRole("button", { name: "Close quick start" });
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "REVIEW SETTINGS" })).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "REVIEW SETTINGS" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Quick start" })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null")).toMatchObject({
      version: 1,
      data: { tutorialVersion: CURRENT_TUTORIAL_VERSION },
    });
  });

  it("dismisses Quick start only from its direct backdrop and not from content activation", () => {
    // This catches backdrop handling that either cannot dismiss or closes while interacting with media/content.
    render(<App services={services()} />);
    const dialog = screen.getByRole("dialog", { name: "Quick start" });
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog", { name: "Quick start" })).toBeInTheDocument();
    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(screen.queryByRole("dialog", { name: "Quick start" })).not.toBeInTheDocument();
  });

  it("routes Quick start actions to Settings focus and the existing single file picker", () => {
    // This catches onboarding creating a second upload input or leaving keyboard users outside Settings.
    const { unmount } = render(<App services={services()} />);
    fireEvent.click(screen.getByRole("button", { name: "REVIEW SETTINGS" }));
    expect(screen.getByRole("heading", { name: "PARAMETERS" })).toHaveFocus();
    unmount();

    window.localStorage.clear();
    render(<App services={services()} />);
    const input = screen.getByLabelText("Add supported files");
    const click = vi.spyOn(input, "click");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Quick start" })).getByRole("button", { name: "ADD FILES" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('input[type="file"][aria-label="Add supported files"]')).toHaveLength(1);
    expect(screen.getByLabelText("Add folder project")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Quick start" })).not.toBeInTheDocument();
  });

  it("replays Quick start from expanded Help without clearing the seen record", () => {
    // This catches Help omitting required limitations or Replay permanently resetting onboarding state.
    markTutorialSeen();
    render(<App services={services()} />);
    const helpButton = screen.getByRole("button", { name: "Help" });
    fireEvent.click(helpButton);
    const help = screen.getByRole("dialog", { name: "Help and workflow guide" });

    for (const copy of [
      "Settings",
      "Review",
      "Package",
      "One-shot and Manual",
      "Formats and privacy",
      "Reset or restart",
    ]) expect(help).toHaveTextContent(copy);

    fireEvent.click(within(help).getByRole("button", { name: "REPLAY QUICK START" }));
    expect(screen.getByRole("dialog", { name: "Quick start" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Help and workflow guide" })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null")).toMatchObject({
      data: { tutorialVersion: CURRENT_TUTORIAL_VERSION },
    });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Quick start" }), { key: "Escape" });
    expect(helpButton).toHaveFocus();
  });

  it("requires confirmation to reset globals, clears the key, and retains uploaded documents", async () => {
    // This catches Reset firing without consent, erasing documents, or leaving saved preferences behind.
    markTutorialSeen();
    render(<App services={services()} />);
    fireEvent.change(screen.getByLabelText("Tone"), { target: { value: "academic" } });
    await waitFor(() => expect(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)).toContain("academic"));
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source"], "retained.md")] },
    });
    await screen.findByDisplayValue("Source");

    fireEvent.click(screen.getByRole("button", { name: "Reset saved preferences" }));
    const confirmation = screen.getByRole("dialog", { name: "Reset saved preferences" });
    expect(within(confirmation).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Tone")).toHaveValue("academic");

    fireEvent.click(screen.getByRole("button", { name: "Reset saved preferences" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Reset saved preferences" })).getByRole("button", { name: "RESET" }));

    expect(screen.getByLabelText("Tone")).toHaveValue("preserve");
    expect(screen.getByDisplayValue("Source")).toBeInTheDocument();
    expect(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
  });

  it("treats the Reset Preferences close button and backdrop as Cancel", () => {
    // This catches a confirmation surface lacking either required non-destructive dismissal route.
    markTutorialSeen();
    render(<App services={services()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset saved preferences" }));
    const dialog = screen.getByRole("dialog", { name: "Reset saved preferences" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close reset preferences" }));
    expect(screen.queryByRole("dialog", { name: "Reset saved preferences" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset saved preferences" }));
    fireEvent.click(screen.getByRole("dialog", { name: "Reset saved preferences" }).parentElement!);
    expect(screen.queryByRole("dialog", { name: "Reset saved preferences" })).not.toBeInTheDocument();
  });

  it("keeps processing controls visible, gives empty Review a direct picker action, and explains persistence", () => {
    // This catches processing controls collapsing, Review becoming a dead end, or privacy copy overstating saved state.
    markTutorialSeen();
    render(<App services={services()} />);

    const processing = screen.getByRole("group", { name: "DOCUMENT PROCESSING" });
    expect(within(processing).getByLabelText("Extract embedded images")).toBeChecked();
    expect(processing).toHaveTextContent(/embedded images are extracted by default/i);
    expect(processing).toHaveTextContent(/page capture and OCR stay off/i);
    const emptyReview = screen.getByLabelText("No selected file");
    expect(emptyReview).toHaveTextContent(/Add a supported file to review/i);
    const input = screen.getByLabelText("Add supported files");
    const click = vi.spyOn(input, "click");
    fireEvent.click(within(emptyReview).getByRole("button", { name: "ADD FILES" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Preferences save locally; documents and contents stay in this session/i)).toBeInTheDocument();
  });

  it("keeps invalid context and page drafts out of storage and bounds saved text fields", async () => {
    // This catches controlled inputs serializing unsafe numbers, descending page ranges, blank languages, or unbounded text.
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 1,
      data: {
        selectedProfileId: "custom",
        customProfileLabel: "Local model",
        contextWindowTokens: 4_096,
        globalSettings: {
          tone: "preserve",
          formality: "preserve",
          length: "preserve",
          outputLanguage: "English",
          customRequirements: "",
        },
        processing: {
          extractEmbeddedImages: true,
          pageSelection: "2-4",
        },
        tutorialVersion: CURRENT_TUTORIAL_VERSION,
      },
    }));
    render(<App services={services()} />);

    fireEvent.change(screen.getByLabelText("Context limit"), {
      target: { value: "9007199254740992" },
    });
    fireEvent.change(screen.getByLabelText("PDF pages"), { target: { value: "3-1" } });
    fireEvent.change(screen.getByLabelText("Output language"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Custom Model label"), { target: { value: "m".repeat(205) } });
    fireEvent.change(screen.getByLabelText("Custom requirements"), { target: { value: "r".repeat(2_001) } });

    expect(screen.getByLabelText("Context limit")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("PDF pages")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Output language")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Custom Model label")).toHaveValue("m".repeat(200));
    expect(screen.getByLabelText("Custom requirements")).toHaveValue("r".repeat(2_000));

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null") as {
        data: {
          contextWindowTokens?: number;
          customProfileLabel?: string;
          globalSettings?: { outputLanguage?: string; customRequirements?: string };
          processing?: { pageSelection?: string };
        };
      };
      expect(saved.data.contextWindowTokens).toBe(4_096);
      expect(saved.data.processing?.pageSelection).toBe("2-4");
      expect(saved.data.globalSettings).not.toHaveProperty("outputLanguage");
      expect(saved.data.customProfileLabel).toBe("m".repeat(200));
      expect(saved.data.globalSettings?.customRequirements).toBe("r".repeat(2_000));
    });
  });
});
