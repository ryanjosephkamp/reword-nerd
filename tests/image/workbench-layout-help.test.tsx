import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImageApp } from "../../src/image/ImageApp";
import { IMAGE_PREFERENCES_STORAGE_KEY } from "../../src/image/preferences";

describe("Image workbench layout and local-only guidance", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("renders the Image workbench regions and exact roving mobile tabs", () => {
    render(<ImageApp />);

    expect(screen.getByRole("main", { name: "reword_nerd Image workbench" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Image queue" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Focused image preview" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Image settings" })).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Image workbench panels" });
    const images = within(tabs).getByRole("tab", { name: "IMAGES" });
    const preview = within(tabs).getByRole("tab", { name: "PREVIEW" });
    const settings = within(tabs).getByRole("tab", { name: "SETTINGS" });
    expect(images).toHaveAttribute("aria-selected", "true");
    expect(images).toHaveAttribute("aria-controls", "image-panel-images");
    expect(preview).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(images, { key: "End" });
    expect(settings).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(settings, { key: "ArrowLeft" });
    expect(preview).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(preview, { key: "Home" });
    expect(images).toHaveAttribute("aria-selected", "true");
  });

  it("shows first-run Quick Start and persists only the tutorial marker when dismissed", () => {
    render(<ImageApp />);

    const dialog = screen.getByRole("dialog", { name: "Image Quick Start" });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "START LOCAL SESSION" })).not.toHaveFocus();
    expect(within(dialog).getByRole("img", { name: "Orange pyramid artwork" })).toHaveAttribute(
      "src",
      "/image/orange-pyramid.webp",
    );
    expect(dialog).toHaveTextContent("Processing stays local in this browser");
    expect(dialog).toHaveTextContent("exact source bytes may retain EXIF or location metadata");
    expect(dialog).toHaveTextContent("one source image and one prompt");
    expect(dialog).toHaveTextContent("No model runs and nothing uploads");
    expect(dialog).toHaveTextContent("Build creates one ZIP for the current confirmed image set in memory");
    expect(dialog).toHaveTextContent("Download becomes available only for that current Ready package");
    expect(dialog).toHaveTextContent("Changes cancel or clear stale package work");

    fireEvent.click(within(dialog).getByRole("button", { name: "START LOCAL SESSION" }));
    expect(screen.queryByRole("dialog", { name: "Image Quick Start" })).not.toBeInTheDocument();
    expect([...Array(window.localStorage.length)].map((_, index) => window.localStorage.key(index))).toEqual([
      IMAGE_PREFERENCES_STORAGE_KEY,
    ]);
    const saved = JSON.parse(window.localStorage.getItem(IMAGE_PREFERENCES_STORAGE_KEY) ?? "null") as {
      data?: Record<string, unknown>;
    };
    expect(saved.data).toEqual({
      defaults: {
        modelFamily: "openai-gpt-image",
        aspectRatio: "match-source",
        sizeIntent: "match-source-where-supported",
        preserveVisibleText: true,
        backgroundBehavior: "preserve-source",
        requestedChanges: "",
        mustPreserve: "",
      },
      tutorialVersion: "0.8",
    });
  });

  it("explains review, invalidation, and the completed local package workflow in Help", () => {
    window.localStorage.setItem(
      IMAGE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, data: { tutorialVersion: "0.8" } }),
    );
    render(<ImageApp />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const help = screen.getByRole("dialog", { name: "Image Help" });
    expect(help).toHaveTextContent("Bulk masks change only checked fields after Apply");
    expect(help).toHaveTextContent("OCR text must be reviewed and accepted or rejected");
    expect(help).toHaveTextContent("BUILD PACKAGE creates the current confirmed set as one ZIP in memory");
    expect(help).toHaveTextContent("DOWNLOAD ZIP is enabled only for the current Ready package");
    expect(help).toHaveTextContent("Changes invalidate confirmation and cancel or clear stale package work");
    expect(help).toHaveTextContent("Building does not download automatically");
    expect(help).toHaveTextContent("No model runs, no credentials are used, and nothing uploads");
  });
});
