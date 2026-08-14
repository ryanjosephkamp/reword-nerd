import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import type { WorkbenchServices } from "../../src/app/workbench/contracts";
import { CURRENT_TUTORIAL_VERSION, PREFERENCES_STORAGE_KEY } from "../../src/app/workbench/preferences";

function textServices(): WorkbenchServices {
  return {
    createDocumentId: () => "portal-text-document",
    preflight: async (files) => files.map((file) => ({
      accepted: true as const,
      file,
      format: "text" as const,
      originalBytes: new TextEncoder().encode("Text session work").buffer,
    })),
    extract: async () => ({
      format: "text",
      extractedText: "Text session work",
      warnings: [],
      originalHash: "original-hash",
      extractedTextHash: "text-hash",
      requiresReview: true,
    }),
    hashText: async () => "review-hash",
    buildPackage: async () => ({ ok: false, error: { code: "NO_DOCUMENTS", message: "unused" } }),
    download: () => ({ ok: true }),
    downloadProgressCopy: () => ({ ok: true }),
  };
}

describe("Text portal", () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, data: { tutorialVersion: CURRENT_TUTORIAL_VERSION } }));
  });

  afterEach(() => window.localStorage.clear());

  it("exposes Text as the active inline portal beside the product brand", () => {
    // This catches a root Text build that loses its portal identity or offers only a hidden route to Image.
    render(<App />);

    const navigation = screen.getByRole("navigation", { name: "Workbench portal" });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TEXT" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "IMAGE" })).toHaveAttribute("href", "/image/");
  });

  it("guards Image navigation when Text contains in-memory session work", async () => {
    // This catches the Text host reporting a clean portal while accepted files are still only in memory.
    render(<App services={textServices()} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Text session work"], "session.txt", { type: "text/plain" })] },
    });
    await screen.findByDisplayValue("Text session work");

    fireEvent.click(screen.getByRole("link", { name: "IMAGE" }));
    expect(screen.getByRole("dialog", { name: "Switch to Image?" })).toBeInTheDocument();
  });
});
